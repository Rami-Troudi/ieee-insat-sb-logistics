import { readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// SQL migrations are authoritative, including SQLite checks, collation and triggers.
const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
  throw new Error(
    "Usage: npm run db:generate -- descriptive_name (lowercase letters, numbers, underscores)."
  );
}
const directory = resolve("drizzle");
const files = (await readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file));
const next = Math.max(-1, ...files.map((file) => Number(file.split("_")[0]))) + 1;
const path = resolve(directory, `${String(next).padStart(4, "0")}_${name}.sql`);
await writeFile(
  path,
  "-- Write the incremental migration here and update src/worker/schema.ts.\n-- Never recreate existing tables or modify a migration already applied.\n",
  { flag: "wx" }
);
console.log(`Created ${path}`);
