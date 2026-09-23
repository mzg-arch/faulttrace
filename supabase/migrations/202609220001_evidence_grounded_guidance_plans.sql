-- Evidence-Grounded Safety Brief and Guidance Plan storage.
-- Apply manually with a trusted migration role. Existing reports, documents,
-- chunks, and plans are not rewritten or deleted.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fault_reports'::regclass
      and conname = 'fault_reports_workspace_id_id_key'
  ) then
    alter table public.fault_reports
      add constraint fault_reports_workspace_id_id_key unique (workspace_id, id);
  end if;
end;
$$;

create table if not exists public.guidance_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  fault_report_id uuid not null,
  status text not null check (status in ('grounded', 'insufficient_evidence')),
  case_summary jsonb not null check (jsonb_typeof(case_summary) = 'object'),
  safety_brief_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(safety_brief_items) = 'array'),
  guided_checks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(guided_checks) = 'array'),
  escalation_criteria jsonb not null default '[]'::jsonb
    check (jsonb_typeof(escalation_criteria) = 'array'),
  evidence_chunk_ids bigint[] not null default '{}',
  evidence_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_snapshot) = 'array'),
  model text check (model is null or length(btrim(model)) between 1 and 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, fault_report_id)
    references public.fault_reports(workspace_id, id) on delete cascade,
  check (
    status <> 'grounded'
    or (
      cardinality(evidence_chunk_ids) > 0
      and jsonb_array_length(safety_brief_items) > 0
      and jsonb_array_length(guided_checks) > 0
      and jsonb_array_length(escalation_criteria) > 0
    )
  ),
  check (
    status <> 'insufficient_evidence'
    or (
      cardinality(evidence_chunk_ids) = 0
      and jsonb_array_length(safety_brief_items) = 0
      and jsonb_array_length(guided_checks) = 0
      and jsonb_array_length(escalation_criteria) = 0
    )
  )
);

create index if not exists guidance_plans_report_created_idx
  on public.guidance_plans(workspace_id, fault_report_id, created_at desc);

alter table public.guidance_plans enable row level security;

revoke all on table public.guidance_plans from anon, authenticated, service_role;
grant select on table public.guidance_plans to authenticated;
grant select, insert on table public.guidance_plans to service_role;

create policy "Technicians read own report guidance and admins read workspace guidance"
  on public.guidance_plans
  for select to authenticated
  using (
    exists (
      select 1
      from public.fault_reports f
      where f.workspace_id = guidance_plans.workspace_id
        and f.id = guidance_plans.fault_report_id
        and (
          private.is_workspace_admin(f.workspace_id)
          or (
            f.created_by = (select auth.uid())
            and exists (
              select 1
              from public.workspace_memberships m
              where m.workspace_id = f.workspace_id
                and m.user_id = (select auth.uid())
                and m.role = 'technician'
            )
          )
        )
    )
  );

-- This service-role-only function returns stable chunk IDs with the same
-- approved-PDF and workspace filters used by deterministic evidence retrieval.
create or replace function public.search_grounded_document_chunks(
  target_workspace_id uuid,
  target_equipment_id uuid,
  target_search_text text,
  target_limit integer default 8
)
returns table (
  chunk_id bigint,
  document_id uuid,
  document_title text,
  document_type public.document_type,
  source_revision text,
  page_number integer,
  excerpt text,
  equipment_linked boolean,
  relevance real
)
language sql
stable
security definer
set search_path = ''
as $$
  with query as (
    select websearch_to_tsquery('english', target_search_text) as value
  )
  select
    c.id as chunk_id,
    d.id as document_id,
    d.title as document_title,
    d.document_type,
    d.source_revision,
    c.page_number,
    c.content as excerpt,
    (d.equipment_id = target_equipment_id) as equipment_linked,
    (
      ts_rank_cd(c.search_vector, query.value)
      + 0.35 * ts_rank_cd(
          to_tsvector(
            'english',
            concat_ws(
              ' ',
              d.title,
              d.document_type::text,
              d.source_revision,
              d.description,
              d.file_name
            )
          ),
          query.value
        )
      + case when d.equipment_id = target_equipment_id then 0.15 else 0 end
    )::real as relevance
  from public.document_chunks c
  join public.documents d
    on d.workspace_id = c.workspace_id
   and d.id = c.document_id
  cross join query
  where c.workspace_id = target_workspace_id
    and d.status = 'approved'
    and d.content_type = 'application/pdf'
    and d.index_status = 'indexed'
    and numnode(query.value) > 0
    and c.search_vector @@ query.value
  order by relevance desc, d.title asc, c.page_number asc, c.chunk_index asc
  limit least(greatest(coalesce(target_limit, 8), 1), 12);
$$;

revoke all on function public.search_grounded_document_chunks(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_grounded_document_chunks(uuid, uuid, text, integer)
  to service_role;
