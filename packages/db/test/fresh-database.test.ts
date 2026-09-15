import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
import { resolveMigrationsFolder } from "../src/migrate.js";

interface SqliteSchemaRow {
  name: string;
  sql: string | null;
  tableName: string;
  type: string;
}

interface AppliedMigrationRow {
  createdAt: number;
  hash: string;
}

const tempDirs: string[] = [];

function createTempDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-fresh-database-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function readSqliteSchema(database: ReturnType<typeof createConnection>) {
  return database.$client
    .prepare<[], SqliteSchemaRow>(
      `
        SELECT type, name, tbl_name AS tableName, sql
        FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name
      `,
    )
    .all();
}

function readAppliedMigrations(database: ReturnType<typeof createConnection>) {
  return database.$client
    .prepare<[], AppliedMigrationRow>(
      `
        SELECT hash, created_at AS createdAt
        FROM __drizzle_migrations
        ORDER BY created_at
      `,
    )
    .all();
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
    const expectedDatabase = createConnection(":memory:");
    try {
      migrate(expectedDatabase, { deferDestructiveLegacyCleanup: true });
      expect(database.$client.pragma("integrity_check", { simple: true })).toBe(
        "ok",
      );
      expect(readSqliteSchema(database)).toEqual(
        readSqliteSchema(expectedDatabase),
      );
      expect(readAppliedMigrations(database)).toEqual(
        readAppliedMigrations(expectedDatabase),
      );
      expect(() => migrate(database)).not.toThrow();
    } finally {
      database.$client.close();
      expectedDatabase.$client.close();
    }
  });

  it("installs a public template with private permissions", () => {
    const templatePath = join(resolveMigrationsFolder(), "fresh.db");
    const dataDir = createTempDir();
    const databasePath = join(dataDir, "bb.db");
    const originalUmask = process.umask(0o077);

    try {
      expect(statSync(templatePath).mode & 0o777).toBe(0o644);
      expect(installFreshDatabase(databasePath)).toBe(true);
      expect(statSync(databasePath).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(originalUmask);
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
