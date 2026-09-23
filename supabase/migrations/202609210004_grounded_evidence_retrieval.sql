-- Grounded Evidence Retrieval for approved PDF documents.
-- Apply manually with a trusted migration role. Existing files and records
-- remain unchanged; existing PDFs require an explicit admin indexing action.

alter table public.documents
  add column if not exists index_status text not null default 'not_indexed',
  add column if not exists indexed_at timestamptz,
  add column if not exists indexed_page_count integer not null default 0,
  add column if not exists indexed_chunk_count integer not null default 0,
  add column if not exists indexing_error_code text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_index_status_check'
  ) then
    alter table public.documents
      add constraint documents_index_status_check
      check (
        index_status in (
          'not_indexed',
          'indexing',
          'indexed',
          'no_text',
          'failed',
          'unsupported'
        )
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_index_counts_check'
  ) then
    alter table public.documents
      add constraint documents_index_counts_check
      check (indexed_page_count >= 0 and indexed_chunk_count >= 0);
  end if;
end;
$$;

create index if not exists documents_workspace_index_status_idx
  on public.documents(workspace_id, status, index_status)
  where content_type = 'application/pdf';

-- The document id is already globally unique. This matching composite key lets
-- chunk references carry and enforce the workspace boundary at the FK level.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_workspace_id_id_key'
  ) then
    alter table public.documents
      add constraint documents_workspace_id_id_key unique (workspace_id, id);
  end if;
end;
$$;

create table if not exists public.document_chunks (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null,
  page_number integer not null check (page_number > 0),
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (length(btrim(content)) between 1 and 5000),
  search_vector tsvector generated always as (
    to_tsvector('english', content)
  ) stored,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, document_id)
    references public.documents(workspace_id, id) on delete cascade,
  unique (document_id, page_number, chunk_index)
);

create index if not exists document_chunks_workspace_document_idx
  on public.document_chunks(workspace_id, document_id, page_number, chunk_index);

create index if not exists document_chunks_search_vector_idx
  on public.document_chunks using gin(search_vector);

alter table public.document_chunks enable row level security;

revoke all on table public.document_chunks from anon, authenticated;
grant select, insert, update, delete on table public.document_chunks to service_role;
grant usage, select on sequence public.document_chunks_id_seq to service_role;

create policy "Members read chunks from approved workspace documents"
  on public.document_chunks
  for select to authenticated
  using (
    exists (
      select 1
      from public.documents d
      where d.workspace_id = document_chunks.workspace_id
        and d.id = document_chunks.document_id
        and d.status = 'approved'
        and d.content_type = 'application/pdf'
        and (
          private.is_workspace_admin(d.workspace_id)
          or private.is_workspace_member(d.workspace_id)
        )
    )
  );

-- This function is callable only by the trusted backend role. It returns
-- verbatim stored chunks from approved, indexed PDFs in the requested
-- workspace and uses deterministic PostgreSQL full-text ranking.
create or replace function public.search_approved_document_chunks(
  target_workspace_id uuid,
  target_equipment_id uuid,
  target_search_text text,
  target_limit integer default 6
)
returns table (
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
  limit least(greatest(coalesce(target_limit, 6), 1), 10);
$$;

revoke all on function public.search_approved_document_chunks(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_approved_document_chunks(uuid, uuid, text, integer)
  to service_role;
