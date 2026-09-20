-- FaultTrace foundation. Apply with a trusted Supabase migration role.
-- Auth invitations and the first workspace/admin membership are created by a
-- trusted backend or migration; no client policy permits self-enrollment.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create schema if not exists private;

create type public.workspace_role as enum ('admin', 'technician');
create type public.document_type as enum ('manual', 'diagram', 'bulletin', 'fault_code_sheet');
create type public.document_status as enum ('draft', 'approved', 'archived');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'technician',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  manufacturer text,
  model text,
  serial_number text,
  asset_tag text,
  location text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, asset_tag)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  equipment_id uuid,
  title text not null check (length(btrim(title)) > 0),
  document_type public.document_type not null,
  status public.document_status not null default 'draft',
  storage_path text not null unique,
  source_revision text,
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, equipment_id)
    references public.equipment(workspace_id, id),
  check (
    storage_path like workspace_id::text || '/' || id::text || '/%'
    and length(storage_path) > length(workspace_id::text || '/' || id::text || '/')
  ),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create table public.resolved_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  equipment_id uuid not null,
  title text not null check (length(btrim(title)) > 0),
  fault_code text,
  symptom text not null check (length(btrim(symptom)) > 0),
  resolution text not null check (length(btrim(resolution)) > 0),
  safety_notes text,
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  is_shared boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, equipment_id)
    references public.equipment(workspace_id, id)
);

create index workspace_memberships_user_id_idx on public.workspace_memberships(user_id);
create index equipment_workspace_id_idx on public.equipment(workspace_id);
create index documents_workspace_status_idx on public.documents(workspace_id, status);
create index documents_equipment_id_idx on public.documents(equipment_id);
create index resolved_cases_workspace_equipment_idx
  on public.resolved_cases(workspace_id, equipment_id, created_at desc);
create index resolved_cases_created_by_idx on public.resolved_cases(created_by);

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function private.touch_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger equipment_updated_at before update on public.equipment
  for each row execute function private.touch_updated_at();
create trigger documents_updated_at before update on public.documents
  for each row execute function private.touch_updated_at();
create trigger resolved_cases_updated_at before update on public.resolved_cases
  for each row execute function private.touch_updated_at();

create function private.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_created
  after insert on auth.users
  for each row execute function private.create_profile_for_user();

-- Keep existing Auth users usable when this migration is applied to a project
-- that already has accounts.
insert into public.profiles (id, display_name)
select id, coalesce(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (id) do nothing;

-- These functions read membership as the migration owner, avoiding recursive
-- membership policies. Keep them outside the exposed public schema.
create function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = target_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create function private.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = target_workspace_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
  );
$$;

create function private.storage_workspace_id(object_name text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

revoke all on function private.create_profile_for_user() from public;
revoke all on function private.touch_updated_at() from public;
revoke all on function private.is_workspace_member(uuid) from public;
revoke all on function private.is_workspace_admin(uuid) from public;
revoke all on function private.storage_workspace_id(text) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;
grant execute on function private.storage_workspace_id(text) to authenticated;

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.equipment enable row level security;
alter table public.documents enable row level security;
alter table public.resolved_cases enable row level security;

revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.workspace_memberships from anon, authenticated;
revoke all on table public.equipment from anon, authenticated;
revoke all on table public.documents from anon, authenticated;
revoke all on table public.resolved_cases from anon, authenticated;

grant select, update (name) on public.workspaces to authenticated;
grant select, update (display_name) on public.profiles to authenticated;
grant select, insert, update (role), delete on public.workspace_memberships to authenticated;
grant select, insert, delete on public.equipment to authenticated;
grant update (name, manufacturer, model, serial_number, asset_tag, location, notes)
  on public.equipment to authenticated;
grant select, insert on public.documents to authenticated;
grant update (title, document_type, equipment_id, source_revision, status, approved_by, approved_at)
  on public.documents to authenticated;
grant select, insert, delete on public.resolved_cases to authenticated;
grant update (title, fault_code, symptom, resolution, safety_notes, citations, is_shared)
  on public.resolved_cases to authenticated;

create policy "Members read their workspaces" on public.workspaces
  for select to authenticated
  using (private.is_workspace_member(id));
create policy "Admins rename their workspaces" on public.workspaces
  for update to authenticated
  using (private.is_workspace_admin(id))
  with check (private.is_workspace_admin(id));

create policy "Members read teammate profiles" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.workspace_memberships m
      where m.user_id = profiles.id
        and private.is_workspace_member(m.workspace_id)
    )
  );
create policy "Users edit their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Members read workspace membership" on public.workspace_memberships
  for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy "Admins add existing users" on public.workspace_memberships
  for insert to authenticated
  with check (
    private.is_workspace_admin(workspace_id)
    and invited_by = (select auth.uid())
  );
create policy "Admins change member roles" on public.workspace_memberships
  for update to authenticated
  using (private.is_workspace_admin(workspace_id))
  with check (private.is_workspace_admin(workspace_id));
create policy "Admins remove other members" on public.workspace_memberships
  for delete to authenticated
  using (private.is_workspace_admin(workspace_id) and user_id <> (select auth.uid()));

create policy "Members read equipment" on public.equipment
  for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy "Admins add equipment" on public.equipment
  for insert to authenticated
  with check (
    private.is_workspace_admin(workspace_id)
    and created_by = (select auth.uid())
  );
create policy "Admins edit equipment" on public.equipment
  for update to authenticated
  using (private.is_workspace_admin(workspace_id))
  with check (private.is_workspace_admin(workspace_id));
create policy "Admins remove equipment" on public.equipment
  for delete to authenticated
  using (private.is_workspace_admin(workspace_id));

create policy "Members read approved documents" on public.documents
  for select to authenticated
  using (
    private.is_workspace_admin(workspace_id)
    or (status = 'approved' and private.is_workspace_member(workspace_id))
  );
create policy "Admins add document records" on public.documents
  for insert to authenticated
  with check (
    private.is_workspace_admin(workspace_id)
    and created_by = (select auth.uid())
    and (status <> 'approved' or approved_by = (select auth.uid()))
  );
create policy "Admins edit document records" on public.documents
  for update to authenticated
  using (private.is_workspace_admin(workspace_id))
  with check (
    private.is_workspace_admin(workspace_id)
    and (status <> 'approved' or approved_by = (select auth.uid()))
  );

create policy "Members read shared or own cases" on public.resolved_cases
  for select to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and (is_shared or created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id))
  );
create policy "Members save their own cases" on public.resolved_cases
  for insert to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and created_by = (select auth.uid())
  );
create policy "Authors and admins edit cases" on public.resolved_cases
  for update to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and (created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id))
  )
  with check (
    private.is_workspace_member(workspace_id)
    and (created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id))
  );
create policy "Authors and admins delete cases" on public.resolved_cases
  for delete to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and (created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id))
  );

-- Private source files use workspace_id/document_id/filename. An admin uploads
-- a new object before creating its draft document row; approved rows then
-- authorize technician reads. Object overwrites and direct deletes are denied.
insert into storage.buckets (id, name, public)
values ('faulttrace-sources', 'faulttrace-sources', false)
on conflict (id) do nothing;

create policy "Admins read source files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'faulttrace-sources'
    and private.is_workspace_admin(private.storage_workspace_id(name))
  );
create policy "Members read approved source files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'faulttrace-sources'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and d.status = 'approved'
        and private.is_workspace_member(d.workspace_id)
    )
  );
create policy "Admins upload source files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'faulttrace-sources'
    and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and private.is_workspace_admin(private.storage_workspace_id(name))
  );
