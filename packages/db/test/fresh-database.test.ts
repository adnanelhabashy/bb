import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConnection,
  installFreshDatabase,
  migrate,
} from "../src/index.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-fresh-database-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

describe("installFreshDatabase", () => {
  it("installs a complete current database without temporary files", () => {
    const dataDir = createTempDir();
    const databasePath = join(dataDir, "bb.db");

    expect(installFreshDatabase(databasePath)).toBe(true);
    expect(readdirSync(dataDir)).toEqual(["bb.db"]);

    const database = createConnection(databasePath);
    try {
      expect(database.$client.pragma("integrity_check", { simple: true })).toBe(
        "ok",
      );
      expect(() => migrate(database)).not.toThrow();
    } finally {
      database.$client.close();
    }
  });

  it("preserves a database file that already exists", () => {
    const dataDir = createTempDir();
    const databasePath = join(dataDir, "bb.db");
    writeFileSync(databasePath, "existing");

    expect(installFreshDatabase(databasePath)).toBe(false);
    expect(readFileSync(databasePath, "utf8")).toBe("existing");
    expect(readdirSync(dataDir)).toEqual(["bb.db"]);
  });

  it("does not install a template for an in-memory database", () => {
    expect(installFreshDatabase(":memory:")).toBe(false);
  });
});
