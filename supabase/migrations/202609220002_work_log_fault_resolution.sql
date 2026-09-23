alter type public.fault_report_status add value if not exists 'resolved';

alter table public.fault_reports
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by_user_id uuid references auth.users(id),
  add column if not exists resolution_summary text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fault_reports_resolution_state_check'
      and conrelid = 'public.fault_reports'::regclass
  ) then
    alter table public.fault_reports
      add constraint fault_reports_resolution_state_check
      check (
        (
          status::text = 'resolved'
          and resolved_at is not null
          and resolved_by_user_id is not null
          and length(btrim(resolution_summary)) between 1 and 4000
          and resolved_by_user_id = created_by
        )
        or (
          status::text <> 'resolved'
          and resolved_at is null
          and resolved_by_user_id is null
          and resolution_summary is null
        )
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fault_reports_workspace_id_id_key'
      and conrelid = 'public.fault_reports'::regclass
  ) then
    alter table public.fault_reports
      add constraint fault_reports_workspace_id_id_key unique (workspace_id, id);
  end if;
end
$$;

do $$
begin
  create type public.fault_report_work_log_entry_type as enum (
    'observation',
    'action_taken',
    'measurement',
    'escalation',
    'resolution'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.fault_report_work_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  fault_report_id uuid not null,
  author_user_id uuid not null references auth.users(id),
  entry_type public.fault_report_work_log_entry_type not null,
  note text not null check (length(btrim(note)) between 1 and 4000),
  created_at timestamptz not null default now(),
  constraint fault_report_work_logs_report_workspace_fkey
    foreign key (workspace_id, fault_report_id)
    references public.fault_reports(workspace_id, id)
    on delete cascade
);

create index if not exists fault_report_work_logs_report_created_idx
  on public.fault_report_work_logs (fault_report_id, created_at, id);

create index if not exists fault_report_work_logs_workspace_idx
  on public.fault_report_work_logs (workspace_id);

alter table public.fault_report_work_logs enable row level security;

revoke all on table public.fault_report_work_logs from anon, authenticated, service_role;
grant select, insert on table public.fault_report_work_logs to authenticated;
grant select, insert on table public.fault_report_work_logs to service_role;

drop policy if exists "Workspace members can read accessible fault report work logs"
  on public.fault_report_work_logs;
create policy "Workspace members can read accessible fault report work logs"
on public.fault_report_work_logs
for select
to authenticated
using (
  private.is_workspace_member(fault_report_work_logs.workspace_id)
  and exists (
    select 1
    from public.fault_reports report
    where report.id = fault_report_work_logs.fault_report_id
      and report.workspace_id = fault_report_work_logs.workspace_id
      and (
        private.is_workspace_admin(fault_report_work_logs.workspace_id)
        or report.created_by = auth.uid()
      )
  )
);

drop policy if exists "Technicians can add their own active report work logs"
  on public.fault_report_work_logs;
create policy "Technicians can add their own active report work logs"
on public.fault_report_work_logs
for insert
to authenticated
with check (
  fault_report_work_logs.author_user_id = auth.uid()
  and fault_report_work_logs.entry_type <> 'resolution'::public.fault_report_work_log_entry_type
  and exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = fault_report_work_logs.workspace_id
      and membership.user_id = auth.uid()
      and membership.role = 'technician'::public.workspace_role
  )
  and exists (
    select 1
    from public.fault_reports report
    where report.id = fault_report_work_logs.fault_report_id
      and report.workspace_id = fault_report_work_logs.workspace_id
      and report.created_by = auth.uid()
      and report.status::text = 'active'
  )
);

create or replace function private.prevent_resolved_fault_report_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status::text = 'resolved' then
    raise exception using
      errcode = '23514',
      message = 'Resolved fault reports are immutable.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_resolved_fault_report_changes on public.fault_reports;
create trigger prevent_resolved_fault_report_changes
before update on public.fault_reports
for each row execute function private.prevent_resolved_fault_report_changes();

revoke all on function private.prevent_resolved_fault_report_changes() from public;

create or replace function public.create_fault_report_work_log(
  target_workspace_id uuid,
  target_report_id uuid,
  target_author_user_id uuid,
  target_entry_type text,
  target_note text
)
returns setof public.fault_report_work_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_log public.fault_report_work_logs;
begin
  if target_entry_type not in ('observation', 'action_taken', 'measurement', 'escalation') then
    raise exception using errcode = '22023', message = 'Invalid manual work-log entry type.';
  end if;

  if length(btrim(coalesce(target_note, ''))) not between 1 and 4000 then
    raise exception using errcode = '22023', message = 'Work-log note is required and must be at most 4000 characters.';
  end if;

  if not exists (
    select 1
    from public.fault_reports report
    where report.workspace_id = target_workspace_id
      and report.id = target_report_id
      and report.created_by = target_author_user_id
      and report.status::text = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'Fault report is not active or accessible.';
  end if;

  insert into public.fault_report_work_logs (
    workspace_id,
    fault_report_id,
    author_user_id,
    entry_type,
    note
  )
  values (
    target_workspace_id,
    target_report_id,
    target_author_user_id,
    target_entry_type::public.fault_report_work_log_entry_type,
    btrim(target_note)
  )
  returning * into created_log;

  return next created_log;
end;
$$;

create or replace function public.resolve_fault_report_with_log(
  target_workspace_id uuid,
  target_report_id uuid,
  target_user_id uuid,
  target_resolution_summary text
)
returns setof public.fault_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_report public.fault_reports;
  normalized_summary text := btrim(coalesce(target_resolution_summary, ''));
begin
  if length(normalized_summary) not between 1 and 4000 then
    raise exception using errcode = '22023', message = 'Resolution summary is required and must be at most 4000 characters.';
  end if;

  update public.fault_reports
  set
    status = 'resolved',
    resolved_at = now(),
    resolved_by_user_id = target_user_id,
    resolution_summary = normalized_summary,
    updated_at = now()
  where workspace_id = target_workspace_id
    and id = target_report_id
    and created_by = target_user_id
    and status::text = 'active'
  returning * into resolved_report;

  if not found then
    raise exception using errcode = 'P0001', message = 'Fault report is not active or accessible.';
  end if;

  insert into public.fault_report_work_logs (
    workspace_id,
    fault_report_id,
    author_user_id,
    entry_type,
    note
  )
  values (
    target_workspace_id,
    target_report_id,
    target_user_id,
    'resolution',
    normalized_summary
  );

  return next resolved_report;
end;
$$;

revoke all on function public.create_fault_report_work_log(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.resolve_fault_report_with_log(uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_fault_report_work_log(uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.resolve_fault_report_with_log(uuid, uuid, uuid, text)
  to service_role;
