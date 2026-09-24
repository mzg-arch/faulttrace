# FaultTrace

FaultTrace is an evidence-grounded industrial maintenance copilot for ABB Accelerator 2026, Theme 2. Company admins curate approved equipment documents. Invited technicians will use those sources to investigate faults, follow cited safety and troubleshooting guidance, and optionally save resolved cases for later reference.

## Repository

```text
apps/web/             Next.js App Router, TypeScript, Tailwind CSS
apps/api/             FastAPI service
supabase/migrations/  PostgreSQL schema and row-level security
.vscode/              Shared editor settings
```

The working prototype supports email/password sign-in, invitation password setup, a role-aware operational dashboard, equipment management, a private approved PDF library, lexical evidence retrieval with page citations, evidence-grounded Gemini guidance, fault intake with a required Safety Gate, private report photo attachments, append-only work logs with technician-controlled resolution, and searchable read-only resolved case history with equipment Quick Recall. Administrators can review workspace reports and technician activity but cannot change them. OCR, photo analysis, embeddings, and LangGraph remain later integrations.

## Local setup

Requirements: Node.js 20.9+, npm, Python 3.11+, and a Supabase project or local Supabase CLI environment.

1. Install web packages from the repository root with `npm install`.
2. Create a Python virtual environment in `apps/api`, activate it, and run `pip install -e .` from that directory.
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/api/.env.example` to `apps/api/.env.local`. Set the web app's public Supabase values. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` only in the API environment. Never put the secret key in `apps/web` or a `NEXT_PUBLIC_` variable.
4. Run `npm run dev:web` from the root and `uvicorn app.main:app --reload` from `apps/api`.

The web app uses port 3000 by default. `/sign-in` submits credentials to Supabase Auth. `/dashboard` checks the signed-in user on the server, redirects unauthenticated visitors to `/sign-in`, and loads the user's profile, workspace membership, role, and workspace. Accounts missing that setup see a secure notice. The API serves `GET /health`, admin-only workspace member and invitation endpoints, and OpenAPI docs at `/docs` on port 8000 by default.

## Data access model

Supabase Auth owns sign-in identities. A profile is created for each new Auth user. Workspace membership carries the `admin` or `technician` role; there is no public self-enrollment policy. A trusted bootstrap process creates the first workspace administrator. Later invitations are authorized by the FastAPI service, sent through Supabase Auth, and finalized into the selected workspace role by server-only logic.

For the first workspace, follow [First test admin setup](docs/first-admin-setup.md). Then follow [Admin invitations setup](docs/admin-invitations-setup.md) before using Team / Access. Keep the Supabase secret key in the API environment only. Disable public signups in the Supabase Auth project settings before using the app with real accounts.

Feature setup and demo flows are documented separately, including [Work Log and Fault Resolution](docs/work-log-resolution.md), [Resolved Case History and Quick Recall](docs/resolved-case-history.md), [Private Fault Report Photo Attachments](docs/fault-report-photo-attachments.md), and the [Role-Aware Operational Dashboard](docs/operational-dashboard.md). Apply each pending Supabase migration manually in timestamp order before testing the corresponding feature.

The initial migration enables RLS and explicit client grants on every application table. Technicians can read workspace equipment and approved documents, and can save cases under their own identity. Shared cases are visible to other workspace members; private cases remain visible to their author and admins. Admins manage equipment and document metadata. Source files live in a private Supabase Storage bucket. The migration enables pgvector, while the embedding table and dimensions wait for the retrieval design.

The initial migration has been applied to the Supabase project, as confirmed by the project owner. The invitation migration is intentionally not applied automatically; run it manually as described in the setup guide.

## Planned deployment

The web workspace is intended for Vercel and the FastAPI service for Render. No deployment configuration or live service has been created in this foundation step.
