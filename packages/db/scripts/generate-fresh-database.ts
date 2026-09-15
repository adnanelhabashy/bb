import { randomUUID } from "node:crypto";
import { renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { createConnection } from "../src/connection.js";
import { migrate } from "../src/migrate.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = join(packageRoot, "drizzle", "fresh.db");
const temporaryPath = join(
  dirname(outputPath),
  `.fresh.db.${process.pid}.${randomUUID()}.tmp`,
);
const database = createConnection(temporaryPath);

try {
  migrate(database, { deferDestructiveLegacyCleanup: true });
  database.$client
    .prepare("DELETE FROM projects WHERE id = ?")
    .run(PERSONAL_PROJECT_ID);
  database.$client.exec("VACUUM");
  database.$client.pragma("wal_checkpoint(TRUNCATE)");
  database.$client.close();
  rmSync(`${outputPath}-shm`, { force: true });
  rmSync(`${outputPath}-wal`, { force: true });
  rmSync(outputPath, { force: true });
  renameSync(temporaryPath, outputPath);
} finally {
  if (database.$client.open) {
    database.$client.close();
  }
  rmSync(temporaryPath, { force: true });
  rmSync(`${temporaryPath}-shm`, { force: true });
  rmSync(`${temporaryPath}-wal`, { force: true });
}
