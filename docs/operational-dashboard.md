# Role-Aware Operational Dashboard

The main FaultTrace dashboard provides a workspace-scoped operational summary while keeping all detailed technician actions on the individual fault-report pages.

## Access model

`GET /workspaces/{workspace_id}/dashboard-summary` verifies the Supabase access token and current workspace membership before reading dashboard data.

- Administrators receive workspace-wide Active and Draft counts, recent Active reports, recent resolutions, affected equipment, and recent technician activity. Their report access remains read-only.
- Technicians receive only their own Draft and Active reports. Resolved counts, recent resolved cases, and resolved-case activity use the shared workspace history already allowed by the Resolved History feature.
- Reports and activity from another workspace are never returned.

The endpoint returns strict `active_report_count` and `draft_report_count` values separately. “My active work” combines the signed-in technician's recent Draft and Active reports while preserving the actual status on every card.

## Dashboard areas

Technicians see:

- My active work and a Start fault report action;
- recent shared resolved cases;
- recent authorized case activity; and
- quick links to equipment, approved documents, and Resolved History.

Administrators see:

- workspace Active and Draft counts;
- recent Active faults and resolutions with report owners;
- equipment with current Active reports;
- recent workspace work-log and resolution activity; and
- quick links to Team, Equipment, Documents, and Resolved History.

Every report card is navigation only. Safety Gate completion, evidence retrieval, guidance generation, work-log entry, photo management, and resolution stay on the report page.

## Database changes

This feature has no new migration. It reads the existing fault reports, equipment, profiles, and immutable work-log records through the FastAPI backend. Apply all earlier pending migrations before testing it.

## Demo flow

1. Start the existing Next.js and FastAPI services.
2. Sign in as a technician with a Draft or Active report.
3. Confirm **My active work** shows only reports owned by that technician, with status, equipment, fault code, and Open action.
4. Confirm recent resolved cases can include another technician's completed workspace case and open in read-only Resolved History.
5. Sign in as an administrator.
6. Confirm **Workspace active faults**, **Recent resolutions**, **Equipment currently affected**, and **Recent activity** contain workspace-wide records and technician owners.
7. Use each quick link and confirm it opens or scrolls to the expected existing area.
8. Sign in to a different workspace and confirm no counts, report cards, affected equipment, or activity from the first workspace appear.

## Validation

From `apps/api`:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m compileall app tests
```

From the repository root:

```powershell
npm exec --workspace @faulttrace/web tsc -- --noEmit
npm run test:session --workspace @faulttrace/web
npm run lint:web
npm run build:web
```

## Current limitations

- Dashboard data refreshes on page load or when the user chooses Refresh; there is no realtime subscription.
- Recent lists are intentionally bounded. The existing Fault Reports and Resolved History areas provide broader navigation.
- Counts and activity are operational records. They do not rank risk, recommend maintenance actions, or replace site escalation procedures.
