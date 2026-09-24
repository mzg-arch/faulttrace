# Work Log and Fault Resolution

FaultTrace now keeps an append-only activity record for each active fault report. The technician who owns the report can record observations, actions taken, measurements, and escalations. That technician can close the report with a required resolution summary. Workspace administrators can review the complete record but cannot add, change, delete, or resolve technician activity.

The work log records maintenance activity; it does not replace current site procedures, authorization, formal LOTO or isolation, hazard assessment, PPE, emergency escalation, or qualified technician judgment. Approved procedures remain controlling.

## Manual migration

Apply [`supabase/migrations/202609220002_work_log_fault_resolution.sql`](../supabase/migrations/202609220002_work_log_fault_resolution.sql) manually in the Supabase SQL Editor before using this feature. Do not apply it through the application.

The additive migration:

- adds `resolved` to the fault-report status values;
- adds `resolved_at`, `resolved_by_user_id`, and `resolution_summary` to `fault_reports`;
- requires a non-empty resolution summary and the owning technician identity for a Resolved report;
- creates `fault_report_work_logs` with the five allowed entry types;
- enables RLS and permits a technician to insert only non-resolution entries for their own Active report;
- lets the report technician and workspace administrators read the report's entries;
- grants no update or delete path, preserving the audit history;
- makes a Resolved report immutable; and
- adds backend-only database functions that atomically recheck Active ownership before adding an entry or resolving a report. Resolution updates the report and creates its immutable resolution entry in one transaction.

Existing fault reports and workspaces remain unchanged. The migration does not weaken RLS, make Storage public, or delete data.

## API routes

- `GET /workspaces/{workspace_id}/fault-reports/{report_id}/work-logs` — the owning technician or an administrator in the same workspace can read an Active report log. Current workspace members can read the log after the report is Resolved.
- `POST /workspaces/{workspace_id}/fault-reports/{report_id}/work-logs` — the owning technician can add an observation, action taken, measurement, or escalation to an Active report.
- `POST /workspaces/{workspace_id}/fault-reports/{report_id}/resolve` — the owning technician can close an Active report with a required resolution summary.

Every route verifies the Supabase access token and workspace membership. The write routes require the technician role and scope the report to the authenticated user's ID. Admin requests remain read-only. The database functions repeat the owner and Active-status checks to protect against concurrent changes.

## Demo test flow

1. Apply the migration in the Supabase SQL Editor.
2. Restart the local FastAPI service so its schema requests use the updated columns and functions.
3. Sign in as the technician who owns the active ACS580 report.
4. Open the report and find **Work Log**.
5. Add one entry of each useful type, such as an observation and a measurement. Confirm each appears in chronological order with its author and timestamp.
6. Leave the resolution summary blank and confirm **Resolve and close report** stays disabled.
7. Enter a concise verified outcome, check the closure confirmation, and choose **Resolve and close report**.
8. Confirm the report status changes to **Resolved**, the resolution summary appears, and a Resolution entry is added automatically.
9. Confirm the add-entry and resolve controls are no longer available on the Resolved report.
10. Sign in as the workspace administrator. Open the same report and confirm the full log and resolution are visible without write controls.
11. Try the same report ID through a different workspace route and confirm it returns not found or forbidden.

## Validation

From `apps/api`:

```powershell
python -m unittest discover -s tests -v
python -m compileall app tests
```

From the repository root:

```powershell
npm run lint:web
npm run build:web
```

## Current limitations

- Work-log entries are plain text; measurements do not yet have unit-specific structured fields.
- Resolution closes the report permanently in this prototype. Reopening requires a separately designed audited workflow.
- Photos can be attached to the report through [Private Fault Report Photo Attachments](fault-report-photo-attachments.md), but individual work-log entries do not have separate attachments.
- Resolved reports are available through the read-only [Resolved Case History and Quick Recall](resolved-case-history.md) flow.
