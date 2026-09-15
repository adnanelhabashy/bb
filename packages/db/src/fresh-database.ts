import { randomUUID } from "node:crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { resolveMigrationsFolder } from "./migrate.js";

const FRESH_DATABASE_TEMPLATE_NAME = "fresh.db";

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

export function installFreshDatabase(databasePath: string): boolean {
  if (databasePath === ":memory:" || existsSync(databasePath)) {
    return false;
  }

  const templatePath = join(
    resolveMigrationsFolder(),
    FRESH_DATABASE_TEMPLATE_NAME,
  );
  const temporaryPath = join(
    dirname(databasePath),
    `.${basename(databasePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    copyFileSync(templatePath, temporaryPath, constants.COPYFILE_EXCL);
    chmodSync(temporaryPath, 0o600);
    try {
      linkSync(temporaryPath, databasePath);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        return false;
      }
      throw error;
    }
    return true;
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
