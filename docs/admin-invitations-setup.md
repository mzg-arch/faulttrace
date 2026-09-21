# Admin invitations setup

FaultTrace administrators send invitations from the website's **Team / Access** section. Normal administrators and technicians never need access to the Supabase Dashboard. The project owner completes the setup below once.

## 1. Apply the invitation migration

Open the Supabase **SQL Editor**, copy all of [`supabase/migrations/202609200001_workspace_invitations.sql`](../supabase/migrations/202609200001_workspace_invitations.sql), and run it once. The migration adds a private invitation tracking table and a server-only finalization function. It does not modify or delete existing rows.

Do this before using Team / Access. The API returns a safe setup error until the migration exists.

## 2. Configure invitation redirects

In the Supabase Dashboard for the FaultTrace project:

1. Open **Authentication → URL Configuration**.
2. For local testing, set **Site URL** to `http://localhost:3000`.
3. Add the exact redirect URL `http://localhost:3000/auth/confirm` to **Redirect URLs**.
4. Keep the default Supabase **Invite user** email template. Its confirmation link verifies the invitation at Supabase and redirects to `/auth/confirm` with a browser session. FaultTrace accepts that session and continues to password setup. Custom SMTP or a custom template is not required for this local flow.

Keep **Allow new users to sign up** disabled. Invites are created through the trusted FastAPI endpoint. The default Supabase email template and sender work with this local invitation flow; no custom SMTP configuration is required.

## 3. Configure the local API

Create `apps/api/.env.local`. It is covered by the repository `.gitignore`. Add:

```dotenv
SUPABASE_URL=<the same FaultTrace Supabase project URL used by the web app>
SUPABASE_PUBLISHABLE_KEY=<the project's publishable key>
SUPABASE_SECRET_KEY=<a backend secret key from Supabase Settings → API Keys>
CORS_ORIGINS=http://localhost:3000
```

Use a modern `sb_secret_...` key where available. The secret key stays only in `apps/api/.env.local` or a backend host's secret manager. Never add it to `apps/web`, a `NEXT_PUBLIC_` variable, Git, browser code, chat, or screenshots.

Install the API package in a Python virtual environment when you are ready, then run it from `apps/api`:

```powershell
uvicorn app.main:app --reload
```

Run the web app from the repository root in another terminal:

```powershell
npm run dev:web
```

## 4. Test a technician invitation

1. Use a separate email address that does not already belong to a user in this Supabase project.
2. Sign in to FaultTrace with the existing `admin` account and open `/dashboard`.
3. In **Team / Access**, enter the person's display name and separate email, select **Technician**, and send the invitation.
4. Confirm the member appears with role `technician` and status `invited`.
5. Open the invitation email in a separate browser profile or private window. Click **Accept invitation and set password**.
6. Set a password on the FaultTrace page. The user should continue to `/dashboard` and see **Technician workspace** automatically. There is no role selector.
7. Refresh the admin's Team / Access list. The technician should show status `active` after accepting the invitation.

Do not test with the signed-in admin's email. Duplicate workspace invitations and existing Auth accounts are rejected safely.

## Current prototype limits

- The web app calls the local FastAPI origin at `http://localhost:8000`. Add a deployment-specific public API URL configuration before hosting either app.
- Supabase's development email service has low limits and no delivery guarantee. Production email delivery remains a later deployment decision.
- Auth invitation and database membership creation span two services. Failed finalization is recorded as `failed`; a production admin recovery or resend workflow should reconcile those records.
- Role changes, invitation cancellation, member removal, audit history, and rate limiting are later administration work.
