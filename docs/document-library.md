# Approved Document Library

FaultTrace stores approved maintenance evidence in the private Supabase Storage bucket named `faulttrace-sources`. Administrators can upload documents, edit their metadata, open them, and archive them. Technicians can search, filter, and open approved documents from their own workspace.

Files are never made public. The API verifies the signed-in user and workspace membership before issuing a signed URL that expires after 60 seconds. Document queries and mutations always include the workspace ID from the protected route.

## Manual setup

Apply [`supabase/migrations/202609210002_document_library.sql`](../supabase/migrations/202609210002_document_library.sql) manually in the Supabase SQL Editor before using the library.

The additive migration:

- adds description and stored-file metadata columns to `public.documents`;
- validates complete stored-file metadata against the supported file types and 10 MB maximum while preserving editable legacy rows;
- adds an index for workspace, approval status, type, and title queries; and
- grants authenticated administrators permission to update the new description field through the existing RLS policies.

It does not change existing document rows, make the bucket public, remove data, disable RLS, or replace the existing workspace policies.

Multipart form parsing also requires one backend dependency that is now declared in `apps/api/pyproject.toml`. Install it when you are ready:

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pip install "python-multipart>=0.0.20,<1"
```

No dependency was installed as part of this milestone. Until it is installed, document upload returns a safe setup error; the rest of the API can still start.

## Supported uploads

- PDF (`.pdf`, `application/pdf`)
- PNG (`.png`, `image/png`)
- JPEG (`.jpg` or `.jpeg`, `image/jpeg`)
- WebP (`.webp`, `image/webp`)
- Maximum size: 10 MB

The API checks the extension, MIME type, size, and leading file signature. Storage paths use `workspace_id/document_id/safe_filename`, and uploads cannot overwrite an existing object.

## Add the first demo document

1. Apply the migration above in the Supabase SQL Editor.
2. Install `python-multipart` with the command above.
3. Restart the API:

   ```powershell
   cd apps/api
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
   ```

4. Start the existing web app from the repository root:

   ```powershell
   npm run dev:web
   ```

5. Sign in as the administrator for **FaultTrace Demo**.
6. In **Approved Document Library**, enter:
   - Title: `ABB ACS580 Hardware Manual`
   - Document type: `Manual`
   - Linked equipment: `ACS580 Drive (FT-DRV-001)` if that demo asset exists
   - Revision / reference: `3AXD50000044785 Rev C`
   - Description: `Approved installation, commissioning, and maintenance source.`
   - File: an approved PDF that is 10 MB or smaller
7. Select **Upload approved document**.
8. Sign in as a technician in the same workspace. Search or filter the Document Library and select **Open approved document**.

Archiving the record removes it from technician lists and blocks technician access. The file and metadata remain available to administrators; nothing is hard deleted.

## API routes

- `GET /workspaces/{workspace_id}/documents` - workspace members; technicians receive approved documents only.
- `POST /workspaces/{workspace_id}/documents` - administrators only; accepts multipart metadata and one file.
- `PATCH /workspaces/{workspace_id}/documents/{document_id}` - administrators only; edits metadata.
- `POST /workspaces/{workspace_id}/documents/{document_id}/archive` - administrators only.
- `POST /workspaces/{workspace_id}/documents/{document_id}/access` - workspace members; technicians can access approved records only.

Every route verifies the Supabase access token and membership. Mutation routes require the `admin` role. The access route returns a short lived private URL rather than storage credentials or a public object URL.
