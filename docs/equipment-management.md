# Equipment management

FaultTrace equipment belongs to one workspace. Administrators can list, add, edit, archive, and reactivate equipment. Technicians can search and select active equipment from their own workspace; archived equipment and management actions are hidden from them.

## Required migration

Apply [`supabase/migrations/202609210001_equipment_management.sql`](../supabase/migrations/202609210001_equipment_management.sql) manually in the Supabase SQL Editor before using the equipment screens.

The migration is additive and preserves existing rows. It:

- adds `equipment.status` with `active` and `archived` values;
- adds an index for workspace, status, and name queries;
- requires a usable asset tag for new or edited equipment while preserving older rows;
- adds case and whitespace insensitive asset tag uniqueness within each workspace;
- lets administrators update status; and
- tightens equipment RLS so technicians can read active equipment only while administrators can also read archived equipment.

The migration does not disable RLS, delete equipment, or change existing equipment values. If older data contains asset tags that differ only by capitalization or surrounding spaces, the normalized unique index will report those duplicates instead of modifying them automatically.

## Add the first demo equipment

1. Apply the migration above in the Supabase SQL Editor.
2. Restart the local FastAPI server so the equipment routes are loaded:

   ```powershell
   cd apps/api
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
   ```

3. From the repository root, start the existing Next.js development server:

   ```powershell
   npm run dev:web
   ```

4. Sign in to FaultTrace as the administrator for **FaultTrace Demo**.
5. Open the **Equipment** section on the dashboard.
6. Enter:
   - Equipment name: `ACS580 Drive`
   - Asset ID / tag: `FT-DRV-001`
   - Manufacturer: `ABB`
   - Model: `ACS580-01`
   - Location: `Line 1 Pump Room`
   - Status: `Active`
7. Select **Add equipment**.
8. Sign in with the technician account and confirm that the active asset appears in the technician Equipment section.

Archiving the asset removes it from the technician list. Administrators continue to see it and can select **Edit**, change its status to **Active**, and save to reactivate it.

## API routes

- `GET /workspaces/{workspace_id}/equipment` — workspace members; technicians receive active equipment only.
- `POST /workspaces/{workspace_id}/equipment` — administrators only.
- `PATCH /workspaces/{workspace_id}/equipment/{equipment_id}` — administrators only.
- `POST /workspaces/{workspace_id}/equipment/{equipment_id}/archive` — administrators only.

Each route verifies the Supabase access token and workspace membership. The mutation routes require the `admin` role, and updates include both workspace ID and equipment ID in their database filters.
