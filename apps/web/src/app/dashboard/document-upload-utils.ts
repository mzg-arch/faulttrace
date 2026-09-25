import type { LibraryDocument } from "./document-types";

export const MAX_DOCUMENT_FILE_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

type DocumentFile = Pick<File, "name" | "size" | "type">;

export type SequentialUploadUpdate<Result> = {
  id: string;
  status: "uploading" | "success" | "failed";
  progress: number;
  result?: Result;
  error?: string;
};

export type SequentialUploadSummary<Result> = {
  uploaded: number;
  failed: number;
  results: Result[];
};

export function validateDocumentFile(file: DocumentFile | null) {
  if (!file) return "Choose a document file.";
  const dotIndex = file.name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(extension) || !ALLOWED_TYPES.includes(file.type)) {
    return "Upload a PDF, PNG, JPG/JPEG, or WEBP file.";
  }
  if (file.size === 0) return "Choose a non-empty document file.";
  if (file.size > MAX_DOCUMENT_FILE_BYTES) return "Document files must be 10 MB or smaller.";
  return null;
}

export function suggestedDocumentTitle(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function applySharedDocumentMetadata<
  Row extends { equipment_id: string; source_revision: string; status: string },
>(rows: readonly Row[], equipmentId: string, revision: string): Row[] {
  return rows.map((row) => (
    row.status === "success"
      ? row
      : { ...row, equipment_id: equipmentId, source_revision: revision }
  ));
}

export async function uploadDocumentsSequentially<Row extends { id: string }, Result>(
  rows: readonly Row[],
  upload: (row: Row, reportProgress: (progress: number) => void) => Promise<Result>,
  onUpdate: (update: SequentialUploadUpdate<Result>) => void,
): Promise<SequentialUploadSummary<Result>> {
  const results: Result[] = [];
  let uploaded = 0;
  let failed = 0;

  for (const row of rows) {
    onUpdate({ id: row.id, status: "uploading", progress: 0 });
    try {
      const result = await upload(row, (progress) => {
        const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
        onUpdate({ id: row.id, status: "uploading", progress: safeProgress });
      });
      results.push(result);
      uploaded += 1;
      onUpdate({ id: row.id, status: "success", progress: 100, result });
    } catch (error) {
      failed += 1;
      onUpdate({
        id: row.id,
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "Document upload failed.",
      });
    }
  }

  return { uploaded, failed, results };
}

export function uploadDocumentWithProgress(
  url: string,
  token: string,
  body: FormData,
  onProgress: (percentage: number) => void,
) {
  return new Promise<LibraryDocument>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("The document service is unavailable."));
    request.onload = () => {
      const response = request.response as LibraryDocument | { detail?: string } | null;
      if (request.status >= 200 && request.status < 300 && response) {
        resolve(response as LibraryDocument);
        return;
      }
      reject(new Error((response as { detail?: string } | null)?.detail || "Document upload failed."));
    };
    request.send(body);
  });
}
