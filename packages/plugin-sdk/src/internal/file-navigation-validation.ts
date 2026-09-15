import type {
  ExperimentalFileLocation,
  ExperimentalFileOpenOptions,
} from "../app-contract.js";
import { fileReferenceSchema } from "@bb/server-contract/file-reference";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function normalizeExperimentalFileLocation(
  value: unknown,
): ExperimentalFileLocation | null | undefined {
  if (value === null) return null;
  if (!isJsonObject(value) || typeof value.kind !== "string") return undefined;

  switch (value.kind) {
    case "line":
      if (
        !hasExactKeys(value, ["kind", "line", "column"]) ||
        !isPositiveSafeInteger(value.line) ||
        (value.column !== null && !isPositiveSafeInteger(value.column))
      ) {
        return undefined;
      }
      return {
        kind: value.kind,
        line: value.line,
        column: value.column,
      };
    case "range":
      if (
        !hasExactKeys(value, ["kind", "startLine", "endLine"]) ||
        !isPositiveSafeInteger(value.startLine) ||
        !isPositiveSafeInteger(value.endLine) ||
        value.endLine < value.startLine
      ) {
        return undefined;
      }
      return {
        kind: value.kind,
        startLine: value.startLine,
        endLine: value.endLine,
      };
    default:
      return undefined;
  }
}

export function normalizeExperimentalFileOpenOptions(
  value: unknown,
): ExperimentalFileOpenOptions | null {
  if (!isJsonObject(value) || !hasExactKeys(value, ["target", "location"])) {
    return null;
  }
  const target = fileReferenceSchema.safeParse(value.target);
  const location = normalizeExperimentalFileLocation(value.location);
  if (!target.success || location === undefined) return null;
  return { target: target.data, location };
}
