# Fault Intake and Pre-Task Safety Gate

FaultTrace technicians can create a Draft fault report for active equipment in their workspace. The report becomes Active only after the same technician completes every mandatory Safety Gate acknowledgement. Workspace administrators can read Draft and Active reports but cannot create or activate them.

FaultTrace supports qualified technicians. The Safety Gate records acknowledgements and does not replace current site procedures, work permits, authorization requirements, formal LOTO or isolation procedures, hazard assessments, required PPE, or professional judgment. Historical cases and automated output never override current approved procedures. Technicians must stop and escalate when conditions are unsafe or uncertain.

## Manual migration

Apply [`supabase/migrations/202609210003_fault_intake.sql`](../supabase/migrations/202609210003_fault_intake.sql) manually in the Supabase SQL Editor before testing this milestone.

The additive migration:

- creates the `fault_report_status` enum with `draft` and `active` values;
- creates `public.fault_reports` separately from completed `resolved_cases`;
- stores intake details, four individual safety acknowledgements, and activation time;
- requires all acknowledgements and an activation timestamp for Active rows;
- requires active, same-workspace equipment when technicians insert through the Data API;
- lets technicians read only their own reports and complete only their own Draft safety gate;
- lets administrators read reports only in their workspace; and
- adds workspace/status and creator indexes.

The migration does not alter existing resolved cases, weaken existing policies, create public Storage, or delete data. Do not apply it through the application.

## API routes

- `GET /workspaces/{workspace_id}/fault-reports` - technicians receive their own reports; administrators receive reports in the route workspace.
- `POST /workspaces/{workspace_id}/fault-reports` - technicians only; creates a Draft report for active workspace equipment.
- `GET /workspaces/{workspace_id}/fault-reports/{report_id}` - technicians can read their own report; workspace administrators can read it.
- `POST /workspaces/{workspace_id}/fault-reports/{report_id}/activate` - the creating technician only; requires all four acknowledgements and moves Draft to Active.

Every route verifies the Supabase access token and workspace membership. The API uses its trusted server credential only after these checks and filters every database request by the route workspace.

## Local demo flow

1. Apply the migration above in the Supabase SQL Editor.
2. Restart the existing API:

   ```powershell
   cd apps/api
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
   ```

3. Start the web app from the repository root:

   ```powershell
   npm run dev:web
   ```

4. Sign in as the technician in **FaultTrace Demo**.
5. In **Equipment**, select an active asset and choose **Start fault report**.
6. Enter an optional fault code, a required symptom, and optional planned task and operating context. Choose **Save and continue**.
7. Confirm the new report is **Draft** and the Safety Gate is shown.
8. Verify **Acknowledge and begin case** remains disabled until all four acknowledgements are checked.
9. Complete all acknowledgements and activate the case.
10. Confirm the Active case shows the intake and completed acknowledgement record. Continue with the evidence, guidance, and work-log feature guides for later milestones.
11. Return to the dashboard and confirm the technician can resume the case from **Fault reports**.
12. Sign out and sign in as the workspace administrator.
13. In **Active fault reports**, open the report and confirm the view is read-only.
14. If another workspace exists, confirm neither its technician nor its administrator can retrieve this report through their workspace route.

## Related milestones

Fault intake and the Safety Gate are followed by [grounded evidence retrieval](evidence-retrieval.md), [evidence-grounded guidance](guidance-plan.md), [private fault-report photo attachments](fault-report-photo-attachments.md), and [Work Log and Fault Resolution](work-log-resolution.md). Photo analysis, OCR, repair branching, and audited case reopening are not implemented.
