import { describe, expect, it } from "vitest";
import {
  normalizeExperimentalFileOpenOptions,
  toFilePreviewLineRange,
} from "./live-file-navigation";

describe("normalizeExperimentalFileOpenOptions", () => {
  it("uses the canonical file-reference schema for its target", () => {
    expect(
      normalizeExperimentalFileOpenOptions({
        target: {
          kind: "workspace",
          environmentId: "env_1",
          path: "src/../app.tsx",
        },
        location: null,
      }),
    ).toBeNull();
  });

  it("rejects invalid locations instead of dropping them", () => {
    expect(
      normalizeExperimentalFileOpenOptions({
        target: {
          kind: "workspace",
          environmentId: "env_1",
          path: "src/app.tsx",
        },
        location: { kind: "range", startLine: 8, endLine: 4 },
      }),
    ).toBeNull();
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "12", null])(
    "rejects invalid line, range endpoint, and column values: %s",
    (value) => {
      const target = {
        kind: "workspace",
        environmentId: "env_1",
        path: "src/app.tsx",
      };
      for (const location of [
        { kind: "line", line: value, column: null },
        { kind: "range", startLine: value, endLine: 20 },
        { kind: "range", startLine: 1, endLine: value },
        ...(value === null ? [] : [{ kind: "line", line: 12, column: value }]),
      ]) {
        expect(
          normalizeExperimentalFileOpenOptions({ target, location }),
        ).toBeNull();
      }
    },
  );

  it("preserves ranges and explicit absence at the preview boundary", () => {
    const target = {
      kind: "workspace",
      environmentId: "env_1",
      path: "src/app.tsx",
    };
    const location = { kind: "range" as const, startLine: 7, endLine: 9 };
    expect(normalizeExperimentalFileOpenOptions({ target, location })).toEqual({
      target,
      location,
    });
    expect(toFilePreviewLineRange(location)).toEqual({
      startLineNumber: 7,
      endLineNumber: 9,
    });
    expect(
      normalizeExperimentalFileOpenOptions({ target, location: null }),
    ).toEqual({ target, location: null });
    expect(toFilePreviewLineRange(null)).toBeNull();
    expect(normalizeExperimentalFileOpenOptions({ target })).toBeNull();
  });

  it("maps a valid line location to the existing preview range", () => {
    expect(
      toFilePreviewLineRange({ kind: "line", line: 42, column: 7 }),
    ).toEqual({ startLineNumber: 42, endLineNumber: 42 });
  });
});
