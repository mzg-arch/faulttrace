# Evidence-Grounded Safety Brief and Guidance Plan

FaultTrace generates a bounded plan from two server-controlled inputs: the active fault-report record and the highest-ranked approved PDF chunks retrieved inside FastAPI. The browser cannot submit evidence, citations, source text, report context, a model name, or generation instructions.

Gemini receives no tools and has no internet, external grounding, OCR, photo, file-upload, embedding, or LangGraph access in this milestone. Structured output is parsed with strict Pydantic models and every citation is checked against the retrieved database chunk IDs before a plan is saved or returned.

FaultTrace remains support for qualified technicians. A saved plan never replaces current site procedures, formal LOTO or isolation requirements, authorization, required PPE, emergency escalation, or qualified technician judgment.

## Manual migration

Apply [`supabase/migrations/202609220001_evidence_grounded_guidance_plans.sql`](../supabase/migrations/202609220001_evidence_grounded_guidance_plans.sql) manually after the evidence-retrieval migration.

The additive migration:

- creates immutable `public.guidance_plans` records with the structured plan and exact evidence snapshot;
- adds a workspace-scoped fault-report foreign key and latest-plan index;
- permits technicians to read plans only for their own reports;
- permits administrators to read plans only for reports in their workspace;
- keeps plan writes behind the backend service role; and
- creates a service-role-only lexical search function that returns stable evidence chunk IDs for citation validation.

It does not update or delete existing records, weaken RLS, or change private Storage.

## Manual dependency

The backend uses Google's official [`google-genai` Python SDK](https://googleapis.github.io/python-genai/), declared in `apps/api/pyproject.toml`, and its [structured-output support](https://ai.google.dev/gemini-api/docs/structured-output). Install it when ready:

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pip install "google-genai>=1,<2"
```

No Gemini package was installed automatically.

## Local Gemini configuration

Add these backend-only values to `apps/api/.env.local`:

```dotenv
GEMINI_API_KEY=your_real_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
```

Restart FastAPI after changing the file. Never add either value to `apps/web`, browser code, source control, screenshots, logs, or support messages. If `GEMINI_API_KEY` is empty, authentication and saved-plan viewing continue to work; generation returns the safe message **AI service is not configured**.

## Grounding rules

A grounded result contains:

- a cited case summary;
- one or more cited Safety Brief items;
- one or more cited Guided Checks;
- one or more cited escalation criteria; and
- a citation-ID list equal to the union of all statement citations.

The backend rejects the entire result without saving when any generated statement lacks citations, a citation ID is duplicated or absent from the retrieved chunks, required grounded sections are empty, or the aggregate citation list differs from the statement citations. No hidden reasoning field is requested, accepted, stored, or returned.

Each generation creates a new immutable plan record. The case page shows the latest saved plan, while each record retains the exact approved excerpt snapshot used at generation time. Signed source links are recreated after authorization and only while the source remains currently approved.

## Insufficient evidence

If lexical retrieval returns no approved chunks, FastAPI stores a deterministic `insufficient_evidence` result without calling Gemini. If chunks exist but Gemini determines they cannot support safe guidance, the backend accepts the result only when all guidance sections and citation lists are empty. FaultTrace then displays an explicit insufficient-evidence state and no checks, warnings, or recommendations.

An administrator can approve and index better source material, after which the report technician can explicitly generate an updated plan. Previous plan rows remain retained for future audit tooling, while the current API and case page display the latest.

## ACS580 demo test flow

1. Apply the evidence retrieval migration if it is still pending.
2. Apply `202609220001_evidence_grounded_guidance_plans.sql` in Supabase SQL Editor.
3. Install `pypdf` and `google-genai` from the declared backend constraints.
4. Add the two Gemini values above to `apps/api/.env.local` and restart FastAPI.
5. Sign in as the **FaultTrace Demo** administrator and confirm the approved ACS580 manual is indexed and linked to the ACS580 equipment.
6. Sign in as the technician who owns the active ACS580 fault report.
7. Open the active case and select **Generate evidence-grounded guidance**.
8. For a grounded result, confirm the case summary, every Safety Brief item, Guided Check, and escalation criterion has one or more `C…` citation chips.
9. Select each citation chip and compare the saved exact excerpt, revision, page number, and approved source PDF.
10. Sign in as the workspace administrator, open the same report under **Active fault reports**, and confirm the latest saved plan appears without generation controls.
11. Remove the Gemini key temporarily or use a workspace with no matching indexed PDF to verify the configured and insufficient-evidence states separately.

## Current limitations

- Retrieval is English lexical full-text search rather than semantic retrieval.
- Gemini sees at most eight approved chunks for a generation.
- Citation-ID validation proves source membership; semantic entailment still depends on the model and technician review of the cited original.
- Scanned PDFs require future OCR, and complex layouts depend on embedded PDF reading order.
- Report photos are excluded from Gemini input. There is no photo analysis, external search, embeddings, LangGraph workflow, or repair branching.
- The current UI displays the latest plan and does not yet provide plan-version history.
