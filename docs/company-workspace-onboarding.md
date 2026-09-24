# Company workspace onboarding

FaultTrace supports a public company setup request at `/create-workspace`. The person submitting the request becomes the first **Administrator**. Every additional Administrator or Technician is invited later from **Team & Access**.

Technicians cannot self-register. The onboarding request has no role field, and the API rejects extra fields. The database function always writes the initial invitation with the `admin` role.

## Apply the migration manually

Apply [`supabase/migrations/202609240001_company_workspace_onboarding.sql`](../supabase/migrations/202609240001_company_workspace_onboarding.sql) after the existing invitation migration.

The migration:

- allows the first invitation to have no human inviter;
- adds a service-role-only transaction that creates one workspace and one initial admin invitation;
- adds a guarded cleanup function for an onboarding attempt that was not finalized;
- grants neither function to browser roles and does not weaken existing RLS policies.

Do not expose the backend secret key to the web application. The browser calls FastAPI, and FastAPI performs the trusted database and invitation operations.

## Product flow

1. Open `http://localhost:3000/create-workspace`.
2. Enter a new company name, the first Administrator's full name, and a work email not already used by this project.
3. Submit the request. Eligible requests receive the standard invitation email.
4. Open the invitation, set a password through the existing `/auth/confirm` and `/set-password` flow, and continue to the normal Admin dashboard.
5. Open **Team & Access** to invite additional Administrators and Technicians.
6. Confirm that an invited Technician signs in normally and sees only the Technician workspace.

Duplicate company and account requests receive the same neutral accepted message as eligible requests. This avoids revealing whether an account or company already exists. Repeated requests are limited per IP address and per normalized email in the API process.

## Prototype rate limiting

The API permits up to five attempts per client IP in 15 minutes and three attempts per normalized email in one hour. Email keys are hashed in process memory. The limiter is suitable for the current single-process prototype. A shared store and trusted-proxy configuration are required before horizontally scaled deployment.

## Failure handling

Workspace and initial invitation creation occur in one database transaction. If the email provider or invitation finalization fails, FastAPI calls a guarded cleanup function. That function removes only a system-created onboarding workspace with no membership; it refuses to remove a finalized workspace.

The Auth provider and PostgreSQL are separate services. A provider account may require trusted operator reconciliation if email creation succeeds but a later network failure prevents both finalization and a conclusive status check. Such an account receives no usable workspace through the failed request.

## Development bootstrap path

[`docs/first-admin-setup.md`](first-admin-setup.md) remains available for local development, recovery, and migration testing. It is not the company onboarding flow used by the product.
