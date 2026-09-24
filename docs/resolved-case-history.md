# Resolved Case History and Quick Recall

FaultTrace keeps completed fault reports as read-only workspace history. Administrators and technicians in the same workspace can search resolved reports, review the recorded outcome, and open the complete report with its safety acknowledgements, attached photos, work log, saved guidance, and evidence snapshot citations.

Historical cases are reference records. They never override current approved procedures, current approved evidence, site authorization, LOTO or isolation, PPE, escalation requirements, or qualified technician judgment.

## Manual migration

Apply [`supabase/migrations/202609230001_resolved_case_history.sql`](../supabase/migrations/202609230001_resolved_case_history.sql) manually in the Supabase SQL Editor after the Work Log migration. Do not apply it through the application.

The additive migration:

- adds a partial index for recent Resolved reports;
- adds a backend-only search function for fault code, symptom, resolution summary, and work-log notes;
- permits current workspace members to read Resolved reports, their work logs, and saved guidance while retaining owner-only access for Draft and Active technician reports;
- keeps the search function unavailable to browser roles; and
- adds no update, reopen, or delete path.

Existing data is not rewritten or deleted. The existing resolved-report immutability trigger and write restrictions remain in effect.

## API routes

- `GET /workspaces/{workspace_id}/resolved-reports` lists newest Resolved reports in the authenticated caller's workspace. Optional query parameters are `equipment_id`, `search`, and `limit` (1 to 100).
- `GET /workspaces/{workspace_id}/resolved-reports/{report_id}` returns one Resolved report from that workspace.
- Existing work-log and saved-guidance read routes also allow workspace technicians to read another technician's Resolved case. Active and Draft reports remain restricted to their owner and workspace administrators.

Every route verifies the Supabase access token and current workspace membership before the backend uses its server-only Supabase credential. The workspace ID is repeated in all report, work-log, guidance, equipment, and document lookups.

## User flow

1. Open **Resolved case history** from either workspace dashboard.
2. Search by fault code, symptom text, resolution text, or a work-log note.
3. Optionally limit results to one equipment item.
4. Open a result to review the complete read-only report.
5. Confirm the page includes its final resolution, chronological work log, saved guidance plan, and saved evidence citations when those records exist.
6. As a technician, start a new fault report and select equipment. The three newest resolved cases for that equipment appear under **Previous resolved cases for this equipment**.

## Isolation and immutability checks

1. Sign in as a technician and confirm the history contains only reports from that technician's current workspace.
2. Open a case created by another technician in the same workspace and confirm it is readable without write, generation, reopen, or delete controls.
3. Change the workspace ID or resolved report ID in an API request to a record from another workspace and confirm the API returns not found or forbidden.
4. Search using text that exists only in a resolution summary, then text that exists only in a work-log note, and confirm each returns the expected case.
5. Filter by equipment and confirm every returned result belongs to that equipment.

## Local validation

From `apps/api`:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m compileall app tests
```

From the repository root:

```powershell
npm exec --workspace @faulttrace/web tsc -- --noEmit
npm run lint:web
npm run build:web
```

## Current limitations

- Search uses deterministic case-insensitive substring matching and returns at most 100 reports. It has no ranking, stemming, fuzzy matching, or pagination.
- Quick Recall shows the three newest resolved reports for the selected equipment; it does not claim that a prior resolution applies to the new fault.
- Resolved reports cannot be reopened. A future audited reopening design would require a separate status transition and audit event.
- Report photos remain read-only in Resolved history; individual work-log entries do not have separate attachments.
