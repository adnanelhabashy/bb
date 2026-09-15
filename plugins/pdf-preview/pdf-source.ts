const PDF_MIME_TYPE = "application/pdf";

function normalizeMimeType(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

function requirePdfMimeType(value: string | null): void {
  if (value === null || normalizeMimeType(value) !== PDF_MIME_TYPE) {
    throw new Error("The file response was not a PDF.");
  }
}

async function requireOk(response: Response): Promise<Response> {
  if (!response.ok) {
    throw new Error(`PDF request failed with status ${response.status}.`);
  }
  return response;
}

export async function loadPdfBlob(
  url: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await requireOk(
    await fetch(url, { credentials: "same-origin", signal }),
  );
  requirePdfMimeType(response.headers.get("content-type"));
  return response.blob();
}
