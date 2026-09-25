import assert from "node:assert/strict";
import test from "node:test";

import {
  applySharedDocumentMetadata,
  MAX_DOCUMENT_FILE_BYTES,
  suggestedDocumentTitle,
  uploadDocumentsSequentially,
  validateDocumentFile,
} from "../src/app/dashboard/document-upload-utils.ts";

test("document validation preserves the existing file rules", () => {
  for (const file of [
    { name: "manual.pdf", type: "application/pdf", size: 12 },
    { name: "diagram.png", type: "image/png", size: 12 },
    { name: "photo.jpg", type: "image/jpeg", size: 12 },
    { name: "photo.jpeg", type: "image/jpeg", size: 12 },
    { name: "photo.webp", type: "image/webp", size: 12 },
  ]) {
    assert.equal(validateDocumentFile(file), null);
  }

  assert.match(
    validateDocumentFile({ name: "manual.pdf", type: "text/plain", size: 12 }),
    /PDF, PNG, JPG\/JPEG, or WEBP/,
  );
  assert.match(
    validateDocumentFile({ name: "manual.pdf", type: "application/pdf", size: 0 }),
    /non-empty/,
  );
  assert.match(
    validateDocumentFile({
      name: "manual.pdf",
      type: "application/pdf",
      size: MAX_DOCUMENT_FILE_BYTES + 1,
    }),
    /10 MB or smaller/,
  );
});

test("selected files receive readable editable titles", () => {
  assert.equal(suggestedDocumentTitle("motor_drive-manual_rev-c.pdf"), "motor drive manual rev c");
  assert.equal(suggestedDocumentTitle("diagram.png"), "diagram");
});

test("shared equipment and revision apply to every pending row", () => {
  const rows = applySharedDocumentMetadata(
    [
      { id: "one", status: "ready", equipment_id: "", source_revision: "A" },
      { id: "two", status: "failed", equipment_id: "old", source_revision: "B" },
      { id: "three", status: "success", equipment_id: "saved", source_revision: "C" },
    ],
    "equipment-1",
    "Rev. D",
  );

  assert.deepEqual(rows.map(({ equipment_id, source_revision }) => ({ equipment_id, source_revision })), [
    { equipment_id: "equipment-1", source_revision: "Rev. D" },
    { equipment_id: "equipment-1", source_revision: "Rev. D" },
    { equipment_id: "saved", source_revision: "C" },
  ]);
});

test("sequential uploads continue after an individual failure", async () => {
  const attempts = [];
  const updates = [];
  let inFlight = 0;
  let maximumInFlight = 0;

  const summary = await uploadDocumentsSequentially(
    [{ id: "first" }, { id: "second" }, { id: "third" }],
    async (row, reportProgress) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      attempts.push(row.id);
      reportProgress(45);
      inFlight -= 1;
      if (row.id === "second") throw new Error("Rejected file");
      return `${row.id}-saved`;
    },
    (update) => updates.push(update),
  );

  assert.deepEqual(attempts, ["first", "second", "third"]);
  assert.equal(maximumInFlight, 1);
  assert.deepEqual(summary, {
    uploaded: 2,
    failed: 1,
    results: ["first-saved", "third-saved"],
  });
  assert.equal(updates.find((update) => update.id === "second" && update.status === "failed")?.error, "Rejected file");
  assert.equal(updates.at(-1)?.status, "success");
});
