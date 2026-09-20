# FaultTrace

FaultTrace is an evidence-grounded industrial maintenance copilot for ABB Accelerator 2026, Theme 2. Company admins curate approved equipment documents. Invited technicians will use those sources to investigate faults, follow cited safety and troubleshooting guidance, and optionally save resolved cases for later reference.

## Repository

```text
apps/web/             Next.js App Router, TypeScript, Tailwind CSS
apps/api/             FastAPI service
supabase/migrations/  PostgreSQL schema and row-level security
.vscode/              Shared editor settings
```

This is a foundation scaffold. The web app has a static sign-in page and a dashboard placeholder guarded by Supabase Auth claims. Credential submission, document ingestion, retrieval, troubleshooting workflows, and case screens are not connected yet. The API currently serves a health endpoint. Docling/OCR, LangGraph, and Gemini are later integrations.

## Local setup (after dependency installation is approved)

Requirements: Node.js 20.9+, npm, Python 3.11+, and a Supabase project or local Supabase CLI environment.

1. Install web packages from the repository root with `npm install`.
2. Create a Python virtual environment in `apps/api`, activate it, and run `pip install -e .` from that directory.
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/api/.env.example` to `apps/api/.env`. Set the web app's `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the project URL and publishable key. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the API environment when its Supabase integration is used. Never put the service-role key in `apps/web` or a `NEXT_PUBLIC_` variable.
4. Run `npm run dev:web` from the root and `uvicorn app.main:app --reload` from `apps/api`.

The web app uses port 3000 by default. `/sign-in` is a visual placeholder; its fields and button are disabled. `/dashboard` verifies Supabase Auth claims on the server and redirects unauthenticated visitors to `/sign-in`. The API serves `GET /health` and OpenAPI docs at `/docs` on port 8000 by default.

## Data access model

Supabase Auth owns sign-in identities. A profile is created for each new Auth user. Workspace membership carries the `admin` or `technician` role; there is no public self-enrollment policy. A trusted bootstrap process must create a workspace and its first admin membership. After that, admins can add existing Auth users to their workspace. An invitation flow that creates Auth users will be added with the application backend.

For the first workspace, create or invite its admin in Supabase Auth, then use a trusted SQL session to insert a `workspaces` row and a `workspace_memberships` row with that Auth user ID and role `admin`. Keep the Supabase secret key in the API environment only.

The initial migration enables RLS and explicit client grants on every application table. Technicians can read workspace equipment and approved documents, and can save cases under their own identity. Shared cases are visible to other workspace members; private cases remain visible to their author and admins. Admins manage equipment and document metadata. Source files live in a private Supabase Storage bucket. The migration enables pgvector, while the embedding table and dimensions wait for the retrieval design.

The initial migration has been applied to the Supabase project, as confirmed by the project owner. This step makes no schema changes.

## Planned deployment

The web workspace is intended for Vercel and the FastAPI service for Render. No deployment configuration or live service has been created in this foundation step.
