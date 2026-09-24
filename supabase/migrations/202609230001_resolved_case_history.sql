-- Read-only resolved case history search for FaultTrace.
-- Depends on 202609220002_work_log_fault_resolution.sql.

create index if not exists fault_reports_workspace_resolved_at_idx
  on public.fault_reports (workspace_id, resolved_at desc, id)
  where status = 'resolved'::public.fault_report_status;

-- Keep Draft and Active technician reports private to their owner, while
-- allowing every current workspace member to read immutable Resolved history.
drop policy if exists "Technicians read own fault reports and admins read workspace reports"
  on public.fault_reports;
create policy "Technicians read own fault reports and admins read workspace reports"
on public.fault_reports
for select
to authenticated
using (
  private.is_workspace_admin(workspace_id)
  or (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.workspace_memberships membership
      where membership.workspace_id = fault_reports.workspace_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'technician'::public.workspace_role
    )
  )
  or (
    status = 'resolved'::public.fault_report_status
    and private.is_workspace_member(workspace_id)
  )
);

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
        or report.created_by = (select auth.uid())
        or report.status = 'resolved'::public.fault_report_status
      )
  )
);

drop policy if exists "Technicians read own report guidance and admins read workspace guidance"
  on public.guidance_plans;
create policy "Technicians read own report guidance and admins read workspace guidance"
on public.guidance_plans
for select
to authenticated
using (
  exists (
    select 1
    from public.fault_reports report
    where report.workspace_id = guidance_plans.workspace_id
      and report.id = guidance_plans.fault_report_id
      and (
        private.is_workspace_admin(report.workspace_id)
        or report.created_by = (select auth.uid())
        or (
          report.status = 'resolved'::public.fault_report_status
          and private.is_workspace_member(report.workspace_id)
        )
      )
  )
);

create or replace function public.search_resolved_fault_reports(
  target_workspace_id uuid,
  target_equipment_id uuid default null,
  target_search_text text default null,
  target_limit integer default 50
)
returns setof public.fault_reports
language sql
stable
security definer
set search_path = ''
as $$
  select report.*
  from public.fault_reports report
  where report.workspace_id = target_workspace_id
    and report.status = 'resolved'::public.fault_report_status
    and (
      target_equipment_id is null
      or report.equipment_id = target_equipment_id
    )
    and (
      length(btrim(coalesce(target_search_text, ''))) = 0
      or strpos(
        lower(coalesce(report.fault_code, '')),
        lower(btrim(target_search_text))
      ) > 0
      or strpos(
        lower(report.symptom),
        lower(btrim(target_search_text))
      ) > 0
      or strpos(
        lower(coalesce(report.resolution_summary, '')),
        lower(btrim(target_search_text))
      ) > 0
      or exists (
        select 1
        from public.fault_report_work_logs work_log
        where work_log.workspace_id = target_workspace_id
          and work_log.fault_report_id = report.id
          and strpos(
            lower(work_log.note),
            lower(btrim(target_search_text))
          ) > 0
      )
    )
  order by report.resolved_at desc, report.id
  limit least(greatest(coalesce(target_limit, 50), 1), 100);
$$;

revoke all on function public.search_resolved_fault_reports(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_resolved_fault_reports(uuid, uuid, text, integer)
  to service_role;
