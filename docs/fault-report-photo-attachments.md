# Private Fault Report Photo Attachments

Technicians can attach JPEG, PNG, and WebP photos to their own Draft or Active fault reports. Photos support the case record only. FaultTrace does not analyze them, derive maintenance guidance from them, or treat them as approved evidence.

Photos support reporting only and do not replace approved inspection procedures.

## Manual migration

Apply [`supabase/migrations/202609230002_private_fault_report_photo_attachments.sql`](../supabase/migrations/202609230002_private_fault_report_photo_attachments.sql) manually in the Supabase SQL Editor after the Resolved Case History migration. Do not apply it through the application.

The migration:

- creates `fault_report_attachments` with workspace, report, uploader, private object path, file metadata, and timestamp fields;
- creates and configures the private `fault-report-attachments` Storage bucket with a 10 MB limit and JPEG, PNG, and WebP MIME allowlist;
- permits an owning technician to add photos only while their report is Draft or Active;
- permits deletion only by the uploader while their owned report remains Draft;
- permits workspace administrators to read attachments without mutation access;
- permits current workspace members to read attachments after the report becomes part of shared Resolved history;
- keeps Draft and Active photos hidden from other technicians; and
- adds backend-only functions that repeat ownership and status checks when attachment metadata is created or deleted.

The bucket is always configured with `public = false`. Existing records and files are not changed or deleted.

## API routes

- `GET /workspaces/{workspace_id}/fault-reports/{report_id}/attachments` lists authorized attachment metadata.
- `POST /workspaces/{workspace_id}/fault-reports/{report_id}/attachments` accepts one multipart `file` from the owning technician for a Draft or Active report.
- `POST /workspaces/{workspace_id}/fault-reports/{report_id}/attachments/{attachment_id}/access` returns a private signed URL that expires after 60 seconds.
- `DELETE /workspaces/{workspace_id}/fault-reports/{report_id}/attachments/{attachment_id}` deletes only the uploader's attachment from their Draft report.

The API validates the access token, workspace membership, report ownership or read access, report status, extension, MIME type, image signature, and size. Storage service credentials stay on the FastAPI backend.

## Demo flow

1. Apply the migration and restart the local FastAPI service.
2. Sign in as a technician and create a Draft fault report for the ACS580.
3. In **Attached photos**, select a JPEG, PNG, or WebP image under 10 MB and choose **Attach photo**.
4. Confirm the thumbnail, sanitized file name, upload time, file size, and **Open** button appear.
5. Choose **Open** and confirm a temporary private Storage URL opens the image.
6. While the report remains Draft, choose **Delete**, confirm the prompt, and verify the photo disappears.
7. Attach another photo and activate the report. Confirm new photos can still be uploaded but existing photos no longer show a delete action.
8. Sign in as the workspace administrator and confirm the same photos are visible without upload or delete controls.
9. Resolve the report and confirm all photos are read-only in the case and Resolved history views.
10. Confirm another workspace cannot list, sign, upload, or delete the report's attachments.

## Validation

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

- Photos have no captions, annotations, work-log entry links, or EXIF display.
- Signed thumbnail links expire after 60 seconds; reloading the section obtains fresh links.
- A failed Storage cleanup after metadata deletion leaves a private, inaccessible object for later administrative cleanup.
- No OCR, image classification, Gemini vision, diagnosis, or maintenance recommendation uses these photos.
