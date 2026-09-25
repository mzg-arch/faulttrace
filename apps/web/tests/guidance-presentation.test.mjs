import assert from "node:assert/strict";
import test from "node:test";

import {
  distinctDocumentTitles,
  evidenceForCitations,
  readableSourceLabel,
  sourceNumber,
} from "../src/app/dashboard/fault-reports/[reportId]/guidance-presentation.ts";

const evidence = [
  {
    chunk_id: 8421,
    document_title: "AC-201 Maintenance Procedure",
  },
  {
    chunk_id: 9934,
    document_title: "Cooling Airflow Service Bulletin",
  },
  {
    chunk_id: 10002,
    document_title: "AC-201 Maintenance Procedure",
  },
];

test("citations resolve only to their exact saved evidence snapshots", () => {
  assert.deepEqual(
    evidenceForCitations(evidence, [9934, 8421, 999999]),
    [evidence[1], evidence[0]],
  );
});

test("technicians see stable human-readable source labels instead of chunk labels", () => {
  assert.equal(sourceNumber(evidence, 9934), 2);
  assert.equal(
    readableSourceLabel(evidence, evidence[1]),
    "Source 2 — Cooling Airflow Service Bulletin",
  );
  assert.doesNotMatch(readableSourceLabel(evidence, evidence[1]), /9934|C9934/);
});

test("collapsed snapshot summary lists each document name once", () => {
  assert.deepEqual(distinctDocumentTitles(evidence), [
    "AC-201 Maintenance Procedure",
    "Cooling Airflow Service Bulletin",
  ]);
});
