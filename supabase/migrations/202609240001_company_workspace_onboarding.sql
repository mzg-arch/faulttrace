-- Apply manually before enabling public company workspace onboarding.
-- This extends the existing invitation model without granting browser clients
-- any direct access to workspaces, memberships, profiles, or invitations.

alter table public.workspace_invitations
  alter column invited_by drop not null;

create or replace function public.begin_company_workspace_onboarding(
  target_workspace_name text,
  target_workspace_slug text,
  target_email text,
  target_display_name text
)
returns table (workspace_id uuid, invitation_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_workspace_name text := btrim(target_workspace_name);
  normalized_email text := lower(btrim(target_email));
  normalized_display_name text := btrim(target_display_name);
  created_workspace_id uuid;
  created_invitation_id uuid;
begin
  if length(normalized_workspace_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Invalid workspace name';
  end if;
  if target_workspace_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or length(target_workspace_slug) not between 2 and 64 then
    raise exception using errcode = '22023', message = 'Invalid workspace slug';
  end if;
  if length(normalized_display_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Invalid administrator name';
  end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(normalized_email) > 320 then
    raise exception using errcode = '22023', message = 'Invalid work email';
  end if;

  -- A deterministic slug and this explicit normalized-name check keep two
  -- public requests from creating the same company under different casing.
  if exists (
    select 1 from public.workspaces w
    where lower(btrim(w.name)) = lower(normalized_workspace_name)
  ) or exists (
    select 1 from auth.users u
    where lower(btrim(u.email)) = normalized_email
  ) or exists (
    select 1 from public.workspace_invitations i
    where i.email = normalized_email
      and i.status in ('sending', 'pending', 'accepted')
  ) then
    raise exception using errcode = '23505', message = 'Onboarding request conflicts with existing access';
  end if;

  insert into public.workspaces (slug, name)
  values (target_workspace_slug, normalized_workspace_name)
  returning id into created_workspace_id;

  insert into public.workspace_invitations (
    workspace_id,
    email,
    display_name,
    role,
    status,
    invited_by
  ) values (
    created_workspace_id,
    normalized_email,
    normalized_display_name,
    'admin'::public.workspace_role,
    'sending',
    null
  )
  returning id into created_invitation_id;

  return query select created_workspace_id, created_invitation_id;
end;
$$;

create or replace function public.cancel_company_workspace_onboarding(
  target_workspace_id uuid,
  target_invitation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_workspace_id uuid;
begin
  -- Cleanup is deliberately narrow: a finalized onboarding has a membership
  -- and can never be removed through this function.
  delete from public.workspaces w
  where w.id = target_workspace_id
    and not exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = w.id
    )
    and exists (
      select 1 from public.workspace_invitations i
      where i.id = target_invitation_id
        and i.workspace_id = w.id
        and i.role = 'admin'::public.workspace_role
        and i.invited_by is null
        and i.status in ('sending', 'failed')
    )
  returning w.id into deleted_workspace_id;

  return deleted_workspace_id is not null;
end;
$$;

revoke all on function public.begin_company_workspace_onboarding(text, text, text, text) from public;
revoke all on function public.cancel_company_workspace_onboarding(uuid, uuid) from public;
grant execute on function public.begin_company_workspace_onboarding(text, text, text, text) to service_role;
grant execute on function public.cancel_company_workspace_onboarding(uuid, uuid) to service_role;
