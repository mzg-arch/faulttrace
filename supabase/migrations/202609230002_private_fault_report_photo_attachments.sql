-- Private photo attachments for workspace fault reports.
-- Depends on 202609220002_work_log_fault_resolution.sql.

create table if not exists public.fault_report_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  fault_report_id uuid not null,
  uploaded_by_user_id uuid not null references auth.users(id),
  storage_path text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  constraint fault_report_attachments_report_workspace_fkey
    foreign key (workspace_id, fault_report_id)
    references public.fault_reports(workspace_id, id)
    on delete cascade,
  constraint fault_report_attachments_storage_path_check
    check (
      storage_path like (
        workspace_id::text || '/' || fault_report_id::text || '/' || id::text || '/%'
      )
      and length(split_part(storage_path, '/', 4)) > 0
      and split_part(storage_path, '/', 5) = ''
    )
);

create index if not exists fault_report_attachments_report_created_idx
  on public.fault_report_attachments (workspace_id, fault_report_id, created_at, id);

alter table public.fault_report_attachments enable row level security;

revoke all on table public.fault_report_attachments from anon, authenticated, service_role;
grant select, insert, delete on table public.fault_report_attachments to authenticated;
grant select, insert, delete on table public.fault_report_attachments to service_role;

create policy "Members read accessible fault report attachments"
on public.fault_report_attachments
for select
to authenticated
using (
  private.is_workspace_member(fault_report_attachments.workspace_id)
  and exists (
    select 1
    from public.fault_reports report
    where report.workspace_id = fault_report_attachments.workspace_id
      and report.id = fault_report_attachments.fault_report_id
      and (
        private.is_workspace_admin(report.workspace_id)
        or report.created_by = (select auth.uid())
        or report.status = 'resolved'::public.fault_report_status
      )
  )
);

create policy "Technicians add photos to own open fault reports"
on public.fault_report_attachments
for insert
to authenticated
with check (
  uploaded_by_user_id = (select auth.uid())
  and exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = fault_report_attachments.workspace_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'technician'::public.workspace_role
  )
  and exists (
    select 1
    from public.fault_reports report
    where report.workspace_id = fault_report_attachments.workspace_id
      and report.id = fault_report_attachments.fault_report_id
      and report.created_by = (select auth.uid())
      and report.status in (
        'draft'::public.fault_report_status,
        'active'::public.fault_report_status
      )
  )
);

create policy "Technicians delete own draft fault report photos"
on public.fault_report_attachments
for delete
to authenticated
using (
  uploaded_by_user_id = (select auth.uid())
  and exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = fault_report_attachments.workspace_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'technician'::public.workspace_role
  )
  and exists (
    select 1
    from public.fault_reports report
    where report.workspace_id = fault_report_attachments.workspace_id
      and report.id = fault_report_attachments.fault_report_id
      and report.created_by = (select auth.uid())
      and report.status = 'draft'::public.fault_report_status
  )
);

create or replace function private.storage_fault_report_id(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(object_name, '/', 2)::uuid
    else null
  end;
$$;

revoke all on function private.storage_fault_report_id(text) from public;
grant execute on function private.storage_fault_report_id(text) to authenticated;

-- Storage path: workspace_id/fault_report_id/attachment_id/file_name.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'fault-report-attachments',
  'fault-report-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Members read accessible fault report photo objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'fault-report-attachments'
  and exists (
    select 1
    from public.fault_report_attachments attachment
    join public.fault_reports report
      on report.workspace_id = attachment.workspace_id
      and report.id = attachment.fault_report_id
    where attachment.storage_path = storage.objects.name
      and private.is_workspace_member(attachment.workspace_id)
      and (
        private.is_workspace_admin(attachment.workspace_id)
        or report.created_by = (select auth.uid())
        or report.status = 'resolved'::public.fault_report_status
      )
  )
);

create policy "Technicians upload photos to own open fault report paths"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'fault-report-attachments'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+\.(jpe?g|png|webp)$'
  and exists (
    select 1
    from public.fault_reports report
    join public.workspace_memberships membership
      on membership.workspace_id = report.workspace_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'technician'::public.workspace_role
    where report.workspace_id = private.storage_workspace_id(name)
      and report.id = private.storage_fault_report_id(name)
      and report.created_by = (select auth.uid())
      and report.status in (
        'draft'::public.fault_report_status,
        'active'::public.fault_report_status
      )
  )
);

create policy "Technicians delete own draft fault report photo objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'fault-report-attachments'
  and exists (
    select 1
    from public.fault_report_attachments attachment
    join public.fault_reports report
      on report.workspace_id = attachment.workspace_id
      and report.id = attachment.fault_report_id
    join public.workspace_memberships membership
      on membership.workspace_id = attachment.workspace_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'technician'::public.workspace_role
    where attachment.storage_path = storage.objects.name
      and attachment.uploaded_by_user_id = (select auth.uid())
      and report.created_by = (select auth.uid())
      and report.status = 'draft'::public.fault_report_status
  )
);

create or replace function private.prevent_resolved_fault_report_attachment_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.fault_reports report
    where report.workspace_id = old.workspace_id
      and report.id = old.fault_report_id
      and report.status = 'resolved'::public.fault_report_status
  ) then
    raise exception using
      errcode = '23514',
      message = 'Resolved fault report attachments are immutable.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_resolved_fault_report_attachment_changes
  on public.fault_report_attachments;
create trigger prevent_resolved_fault_report_attachment_changes
before update or delete on public.fault_report_attachments
for each row execute function private.prevent_resolved_fault_report_attachment_changes();

revoke all on function private.prevent_resolved_fault_report_attachment_changes()
  from public;

create or replace function public.create_fault_report_attachment(
  target_id uuid,
  target_workspace_id uuid,
  target_report_id uuid,
  target_user_id uuid,
  target_storage_path text,
  target_file_name text,
  target_mime_type text,
  target_size_bytes bigint
)
returns setof public.fault_report_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_attachment public.fault_report_attachments;
begin
  if not exists (
    select 1
    from public.fault_reports report
    join public.workspace_memberships membership
      on membership.workspace_id = report.workspace_id
      and membership.user_id = target_user_id
      and membership.role = 'technician'::public.workspace_role
    where report.workspace_id = target_workspace_id
      and report.id = target_report_id
      and report.created_by = target_user_id
      and report.status in (
        'draft'::public.fault_report_status,
        'active'::public.fault_report_status
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Fault report is not open or accessible.';
  end if;

  insert into public.fault_report_attachments (
    id,
    workspace_id,
    fault_report_id,
    uploaded_by_user_id,
    storage_path,
    file_name,
    mime_type,
    size_bytes
  )
  values (
    target_id,
    target_workspace_id,
    target_report_id,
    target_user_id,
    target_storage_path,
    target_file_name,
    target_mime_type,
    target_size_bytes
  )
  returning * into created_attachment;

  return next created_attachment;
end;
$$;

create or replace function public.delete_draft_fault_report_attachment(
  target_workspace_id uuid,
  target_report_id uuid,
  target_attachment_id uuid,
  target_user_id uuid
)
returns setof public.fault_report_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_attachment public.fault_report_attachments;
begin
  delete from public.fault_report_attachments attachment
  using public.fault_reports report
  where attachment.workspace_id = target_workspace_id
    and attachment.fault_report_id = target_report_id
    and attachment.id = target_attachment_id
    and attachment.uploaded_by_user_id = target_user_id
    and report.workspace_id = attachment.workspace_id
    and report.id = attachment.fault_report_id
    and report.created_by = target_user_id
    and report.status = 'draft'::public.fault_report_status
  returning attachment.* into deleted_attachment;

  if not found then
    raise exception using errcode = 'P0001', message = 'Draft attachment is not accessible.';
  end if;

  return next deleted_attachment;
end;
$$;

revoke all on function public.create_fault_report_attachment(uuid, uuid, uuid, uuid, text, text, text, bigint)
  from public, anon, authenticated;
revoke all on function public.delete_draft_fault_report_attachment(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_fault_report_attachment(uuid, uuid, uuid, uuid, text, text, text, bigint)
  to service_role;
grant execute on function public.delete_draft_fault_report_attachment(uuid, uuid, uuid, uuid)
  to service_role;
