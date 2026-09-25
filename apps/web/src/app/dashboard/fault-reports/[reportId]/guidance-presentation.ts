import type { GuidanceEvidence } from "../../fault-report-types";

export function evidenceForCitations(
  evidence: GuidanceEvidence[],
  citationIds: number[],
) {
  const byChunkId = new Map(evidence.map((item) => [item.chunk_id, item]));
  return citationIds.flatMap((citationId) => {
    const match = byChunkId.get(citationId);
    return match ? [match] : [];
  });
}

export function sourceNumber(
  evidence: GuidanceEvidence[],
  chunkId: number,
) {
  const index = evidence.findIndex((item) => item.chunk_id === chunkId);
  return index === -1 ? null : index + 1;
}

export function readableSourceLabel(
  evidence: GuidanceEvidence[],
  item: GuidanceEvidence,
) {
  const number = sourceNumber(evidence, item.chunk_id);
  return `${number ? `Source ${number}` : "Approved source"} — ${item.document_title}`;
}

export function distinctDocumentTitles(evidence: GuidanceEvidence[]) {
  return [...new Set(evidence.map((item) => item.document_title))];
}
