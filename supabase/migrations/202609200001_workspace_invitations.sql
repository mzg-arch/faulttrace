-- Apply manually in the Supabase SQL Editor before enabling Team / Access.
-- Invitation records are private to the trusted API. Existing data is untouched.

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (
    email = lower(btrim(email))
    and length(email) between 3 and 320
  ),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  role public.workspace_role not null,
  status text not null default 'sending'
    check (status in ('sending', 'pending', 'accepted', 'failed')),
  auth_user_id uuid references auth.users(id) on delete set null,
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create unique index workspace_invitations_workspace_auth_user_idx
  on public.workspace_invitations(workspace_id, auth_user_id)
  where auth_user_id is not null;

create index workspace_invitations_auth_user_idx
  on public.workspace_invitations(auth_user_id);

create trigger workspace_invitations_updated_at
  before update on public.workspace_invitations
  for each row execute function private.touch_updated_at();

alter table public.workspace_invitations enable row level security;
revoke all on table public.workspace_invitations from anon, authenticated;
grant select, insert, update, delete on public.workspace_invitations to service_role;

create function public.finalize_workspace_invitation(
  target_invitation_id uuid,
  target_auth_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_invitation public.workspace_invitations;
begin
  select * into target_invitation
  from public.workspace_invitations
  where id = target_invitation_id
  for update;

  if target_invitation.id is null or target_invitation.status <> 'sending' then
    raise exception 'Invitation is not available for finalization';
  end if;

  insert into public.profiles (id, display_name)
  values (target_auth_user_id, target_invitation.display_name)
  on conflict (id) do update
    set display_name = excluded.display_name;

  insert into public.workspace_memberships (
    workspace_id,
    user_id,
    role,
    invited_by
  ) values (
    target_invitation.workspace_id,
    target_auth_user_id,
    target_invitation.role,
    target_invitation.invited_by
  );

  update public.workspace_invitations
  set status = 'pending', auth_user_id = target_auth_user_id
  where id = target_invitation_id;
end;
$$;

revoke all on function public.finalize_workspace_invitation(uuid, uuid) from public;
grant execute on function public.finalize_workspace_invitation(uuid, uuid) to service_role;
