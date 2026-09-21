-- Equipment management additions for FaultTrace.
-- Apply manually with a trusted migration role. Existing equipment is preserved.

alter table public.equipment
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.equipment'::regclass
      and conname = 'equipment_status_check'
  ) then
    alter table public.equipment
      add constraint equipment_status_check
      check (status in ('active', 'archived'));
  end if;
end;
$$;

-- Enforce a usable asset tag for new and edited rows without rejecting or
-- rewriting older rows that may not have one yet.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.equipment'::regclass
      and conname = 'equipment_asset_tag_required_check'
  ) then
    alter table public.equipment
      add constraint equipment_asset_tag_required_check
      check (
        asset_tag is not null
        and length(btrim(asset_tag)) between 1 and 80
      ) not valid;
  end if;
end;
$$;

create index if not exists equipment_workspace_status_name_idx
  on public.equipment(workspace_id, status, name);

-- Preserve the original constraint and add case/whitespace-insensitive asset
-- tag uniqueness for non-empty values.
create unique index if not exists equipment_workspace_asset_tag_normalized_idx
  on public.equipment(workspace_id, lower(btrim(asset_tag)))
  where asset_tag is not null and length(btrim(asset_tag)) > 0;

grant update (status) on public.equipment to authenticated;

-- Admins retain access to archived equipment. Technicians can read active
-- equipment only, even if they call the Data API directly.
alter policy "Members read equipment" on public.equipment
  using (
    private.is_workspace_admin(workspace_id)
    or (
      status = 'active'
      and private.is_workspace_member(workspace_id)
    )
  );
