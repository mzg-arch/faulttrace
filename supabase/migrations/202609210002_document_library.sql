-- Approved Document Library additions for FaultTrace.
-- Apply manually with a trusted migration role. Existing documents and files
-- are preserved, and the faulttrace-sources bucket remains private.

alter table public.documents
  add column if not exists description text,
  add column if not exists file_name text,
  add column if not exists content_type text,
  add column if not exists size_bytes bigint;

-- Validate complete file metadata when it is present while leaving older rows
-- with no file metadata editable and unchanged.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_file_metadata_check'
  ) then
    alter table public.documents
      add constraint documents_file_metadata_check
      check (
        (
          file_name is null
          and content_type is null
          and size_bytes is null
        )
        or (
          file_name is not null
          and length(btrim(file_name)) between 1 and 255
          and content_type in (
            'application/pdf',
            'image/png',
            'image/jpeg',
            'image/webp'
          )
          and size_bytes between 1 and 10485760
        )
      ) not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_description_length_check'
  ) then
    alter table public.documents
      add constraint documents_description_length_check
      check (description is null or char_length(description) <= 2000) not valid;
  end if;
end;
$$;

create index if not exists documents_workspace_status_type_title_idx
  on public.documents(workspace_id, status, document_type, title);

grant update (description) on public.documents to authenticated;

-- The foundation policies already keep the bucket private, allow admins to
-- manage document records, and allow technicians to read approved documents
-- from their own workspace only. Archived rows do not satisfy that read rule.
