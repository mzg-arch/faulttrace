-- Fault Intake and Pre-Task Safety Gate for FaultTrace.
-- Apply manually with a trusted migration role. Existing cases and data are
-- unchanged; active troubleshooting remains separate from resolved history.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'fault_report_status'
  ) then
    create type public.fault_report_status as enum ('draft', 'active');
  end if;
end;
$$;

create table if not exists public.fault_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  equipment_id uuid not null,
  fault_code text check (fault_code is null or length(btrim(fault_code)) between 1 and 120),
  symptom text not null check (length(btrim(symptom)) between 1 and 4000),
  planned_task text check (planned_task is null or length(btrim(planned_task)) between 1 and 2000),
  operating_context text check (
    operating_context is null or length(btrim(operating_context)) between 1 and 4000
  ),
  status public.fault_report_status not null default 'draft',
  ack_authorized_qualified boolean not null default false,
  ack_loto_isolation boolean not null default false,
  ack_ppe_stored_energy boolean not null default false,
  ack_stop_escalate boolean not null default false,
  activated_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, equipment_id)
    references public.equipment(workspace_id, id),
  check (
    status = 'draft'
    or (
      ack_authorized_qualified
      and ack_loto_isolation
      and ack_ppe_stored_energy
      and ack_stop_escalate
      and activated_at is not null
    )
  )
);

create index if not exists fault_reports_workspace_status_created_idx
  on public.fault_reports(workspace_id, status, created_at desc);

create index if not exists fault_reports_creator_created_idx
  on public.fault_reports(created_by, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.fault_reports'::regclass
      and tgname = 'fault_reports_updated_at'
      and not tgisinternal
  ) then
    create trigger fault_reports_updated_at
      before update on public.fault_reports
      for each row execute function private.touch_updated_at();
  end if;
end;
$$;

alter table public.fault_reports enable row level security;

revoke all on table public.fault_reports from anon, authenticated;
grant select, insert on public.fault_reports to authenticated;
grant update (
  status,
  ack_authorized_qualified,
  ack_loto_isolation,
  ack_ppe_stored_energy,
  ack_stop_escalate,
  activated_at
) on public.fault_reports to authenticated;

create policy "Technicians read own fault reports and admins read workspace reports"
  on public.fault_reports
  for select to authenticated
  using (
    private.is_workspace_admin(workspace_id)
    or (
      created_by = (select auth.uid())
      and exists (
        select 1
        from public.workspace_memberships m
        where m.workspace_id = fault_reports.workspace_id
          and m.user_id = (select auth.uid())
          and m.role = 'technician'
      )
    )
  );

create policy "Technicians create own draft fault reports"
  on public.fault_reports
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'draft'
    and not ack_authorized_qualified
    and not ack_loto_isolation
    and not ack_ppe_stored_energy
    and not ack_stop_escalate
    and activated_at is null
    and exists (
      select 1
      from public.workspace_memberships m
      where m.workspace_id = fault_reports.workspace_id
        and m.user_id = (select auth.uid())
        and m.role = 'technician'
    )
    and exists (
      select 1
      from public.equipment e
      where e.workspace_id = fault_reports.workspace_id
        and e.id = fault_reports.equipment_id
        and e.status = 'active'
    )
  );

create policy "Technicians complete own fault report safety gate"
  on public.fault_reports
  for update to authenticated
  using (
    created_by = (select auth.uid())
    and status = 'draft'
    and exists (
      select 1
      from public.workspace_memberships m
      where m.workspace_id = fault_reports.workspace_id
        and m.user_id = (select auth.uid())
        and m.role = 'technician'
    )
  )
  with check (
    created_by = (select auth.uid())
    and status = 'active'
    and ack_authorized_qualified
    and ack_loto_isolation
    and ack_ppe_stored_energy
    and ack_stop_escalate
    and activated_at is not null
    and exists (
      select 1
      from public.workspace_memberships m
      where m.workspace_id = fault_reports.workspace_id
        and m.user_id = (select auth.uid())
        and m.role = 'technician'
    )
  );
