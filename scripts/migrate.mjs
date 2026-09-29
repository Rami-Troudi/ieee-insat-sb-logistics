import { createClient } from "@libsql/client";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (url && /ieee[-_]?ras[-_]?insat/i.test(url)) {
  throw new Error(
    "Refusing to migrate the RAS database; configure a separate IEEE INSAT SB database."
  );
}
if (!url || (!url.startsWith("file:") && !authToken)) {
  throw new Error("Set TURSO_DATABASE_URL and, for a remote database, TURSO_AUTH_TOKEN.");
}

const client = createClient({ url, authToken });
try {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const directory = resolve("drizzle");
  const migrations = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of migrations) {
    const existing = await client.execute({
      sql: "SELECT 1 FROM app_schema_migrations WHERE name=?",
      args: [name],
    });
    if (existing.rows.length) continue;
    const sql = await readFile(resolve(directory, name), "utf8");
    const transaction = await client.transaction("write");
    try {
      await transaction.executeMultiple(sql);
      await transaction.execute({
        sql: "INSERT INTO app_schema_migrations(name,applied_at) VALUES(?,?)",
        args: [name, Date.now()],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
    console.log(`Applied ${name}`);
  }
  console.log("Database migrations are current.");
} finally {
  client.close();
}
