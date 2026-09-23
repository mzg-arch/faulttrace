# Grounded Evidence Retrieval

FaultTrace retrieves verbatim text excerpts only from approved PDF documents in the signed-in user's workspace. Retrieval is deterministic PostgreSQL full-text search. It does not create an answer, diagnosis, safety brief, repair recommendation, or synthetic citation.

Each result identifies the approved document, document type, revision or reference, PDF page number, exact extracted excerpt, and a temporary signed link to the private source file. Equipment-linked documents receive a ranking boost, while relevant general workspace PDFs can still appear.

Approved procedures remain controlling. Retrieved excerpts, historical cases, and future automated output never replace current site procedures, authorization, formal LOTO or isolation requirements, required PPE, or qualified technician judgment. Review the original source before acting.

## Manual migration

Apply [`supabase/migrations/202609210004_grounded_evidence_retrieval.sql`](../supabase/migrations/202609210004_grounded_evidence_retrieval.sql) manually in the Supabase SQL Editor.

The additive migration:

- adds PDF indexing state and safe counts to `public.documents`;
- creates `public.document_chunks` with workspace, document, page, chunk, and exact extracted text fields;
- creates a generated English `tsvector` and GIN index for deterministic full-text retrieval;
- adds indexes for workspace/document and equipment-linked lookups;
- defines an approved-workspace RLS read policy as defense in depth while keeping direct client table access disabled;
- keeps chunk reads and writes routed through the trusted backend; and
- creates a service-role-only retrieval function that filters approved, indexed PDFs and boosts documents linked to the report equipment.

It does not rewrite existing documents, index existing files automatically, weaken current RLS, change the private Storage bucket, or delete data.

## Manual dependency

PDF text extraction uses `pypdf`, declared in `apps/api/pyproject.toml`. It was not installed automatically. Install it when ready:

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pip install "pypdf>=5,<7"
```

Restart the API after installation.

## PDF indexing behavior

- Newly uploaded approved PDFs are indexed during the authorized upload request.
- Existing PDFs remain `not_indexed` until an administrator chooses **Index PDF**.
- Reindexing is always an explicit administrator action.
- Extraction preserves the original PDF page number and never combines text across pages.
- Chunks contain normalized extracted text without generated wording or summaries.
- Scanned PDFs and pages without embedded readable text are marked **No readable PDF text**.
- OCR is not attempted.
- PNG, JPEG, and WebP documents remain available in the private library but are not text-searchable.
- Encrypted, malformed, or excessively expansive PDFs receive a safe failed status without exposing parser details.

## Index the existing ACS580 demo PDF

1. Apply the migration above in Supabase SQL Editor.
2. Install `pypdf` using the manual command above.
3. Restart the API:

   ```powershell
   cd apps/api
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
   ```

4. Start the web application from the repository root:

   ```powershell
   npm run dev:web
   ```

5. Sign in as the **FaultTrace Demo** administrator.
6. Open **Approved Document Library**.
7. Find the approved `ABB ACS580 Hardware Manual` PDF linked to `ACS580 Drive`.
8. Choose **Index PDF**.
9. Confirm the document shows a searchable-page count. If it shows **No readable PDF text**, the file has no extractable text and requires a text-based PDF for this milestone.

## Retrieve evidence from the active ACS580 report

1. Sign in as the technician who owns the ACS580 fault report.
2. Open the report and complete the Safety Gate if the report is still Draft.
3. On the Active case page, find **Approved evidence**.
4. Choose **Retrieve approved evidence**.
5. Confirm each result shows:
   - source document title;
   - document type;
   - revision or reference;
   - PDF page number;
   - exact extracted excerpt; and
   - **Open source document**.
6. Open the temporary source link and verify the cited page in the original approved PDF before acting.
7. Sign in as the workspace administrator, open the same Active report from **Active fault reports**, and confirm the evidence retrieval is available read-only.
8. Confirm Draft reports cannot retrieve evidence and users from another workspace cannot access the report, chunks, or signed source.

## Current limitations

- Text must already be embedded in the PDF; scanned images require future OCR.
- PDF reading order depends on the document's embedded text structure and may differ from visual column order.
- Retrieval uses English lexical stemming and exact term matching rather than semantic similarity.
- Existing PDFs require explicit administrator indexing.
- Source links expire after five minutes and can be refreshed by retrieving again.
- The retrieval endpoint itself returns excerpts without a generated answer or diagnosis. The separate guidance-plan milestone can consume these server-retrieved chunks after citation validation.
