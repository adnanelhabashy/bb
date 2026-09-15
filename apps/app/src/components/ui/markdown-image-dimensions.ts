export interface MarkdownImageDimensions {
  width: number;
  height: number;
}

const STORAGE_KEY = "bb.markdown-image-dimensions.v1";
const ENTRY_LIMIT = 256;
const SOURCE_LENGTH_LIMIT = 2048;

function isDimensions(value: unknown): value is MarkdownImageDimensions {
  if (typeof value !== "object" || value === null) return false;
  return (
    "width" in value &&
    "height" in value &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function readEntries(): Map<string, MarkdownImageDimensions> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return new Map();
    return new Map(
      value.slice(-ENTRY_LIMIT).filter(
        (entry): entry is [string, MarkdownImageDimensions] =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === "string" &&
          entry[0].length <= SOURCE_LENGTH_LIMIT &&
          isDimensions(entry[1]),
      ),
    );
  } catch {
    return new Map();
  }
}

export function readMarkdownImageDimensions(
  source: string,
): MarkdownImageDimensions | undefined {
  return readEntries().get(source);
}

export function rememberMarkdownImageDimensions(
  source: string,
  dimensions: MarkdownImageDimensions,
): void {
  if (
    !source ||
    source.length > SOURCE_LENGTH_LIMIT ||
    /^(data|blob):/iu.test(source) ||
    !isDimensions(dimensions)
  ) return;
  const entries = readEntries();
  entries.delete(source);
  entries.set(source, dimensions);
  while (entries.size > ENTRY_LIMIT) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...entries]));
  } catch {}
}
