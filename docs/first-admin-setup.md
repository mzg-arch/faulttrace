# Development/bootstrap first admin setup

This is a development, recovery, and migration-test path for a trusted project operator. Real company owners should use the product flow in [Company workspace onboarding](company-workspace-onboarding.md). The existing migration creates a profile when an Auth user is created and allows signed-in members to read their own workspace role.

1. In **Authentication → Settings → General** (the exact Dashboard label may vary), turn off **Allow new users to sign up**. This is a project Auth setting, not a database migration. Keep email/password sign-in enabled.
2. In **Authentication → Users → Add user**, choose **Create new user** if offered. Enter a test email and password you control, confirm the email if the Dashboard asks, and copy the new user's UUID from the Users list. Do not insert directly into `auth.users` or put a backend secret key in this repository.
3. In the **SQL Editor**, run the following as a project administrator. Replace the UUID, workspace slug, and display names first. The slug must be unique and use lowercase letters, numbers, and hyphens.

```sql
begin;

insert into public.profiles (id, display_name)
values ('<AUTH_USER_UUID>'::uuid, 'Test Admin')
on conflict (id) do update set display_name = excluded.display_name;

with new_workspace as (
  insert into public.workspaces (slug, name)
  values ('faulttrace-demo', 'FaultTrace Demo')
  returning id
)
insert into public.workspace_memberships (workspace_id, user_id, role)
select id, '<AUTH_USER_UUID>'::uuid, 'admin'::public.workspace_role
from new_workspace;

commit;
```

4. Check the link in the SQL Editor, replacing the UUID:

```sql
select p.id, p.display_name, w.name as workspace_name, m.role
from public.profiles p
join public.workspace_memberships m on m.user_id = p.id
join public.workspaces w on w.id = m.workspace_id
where p.id = '<AUTH_USER_UUID>'::uuid;
```

5. Start the web app locally and sign in at `/sign-in`. The dashboard should show the **Administrator** role. If it shows a setup notice, confirm the Auth UUID matches the membership and that the initial migration is applied. Use **Team & Access** for subsequent Administrator and Technician invitations.

If the workspace slug already exists, do not rerun the workspace insert. Find its ID in the SQL Editor and insert only the membership for that workspace and user. This guide assumes a new workspace for the first test admin.
