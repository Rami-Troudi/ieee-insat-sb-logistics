import { createClient } from "@libsql/client";
import { readFile, stat } from "node:fs/promises";
const url = process.env.TURSO_DATABASE_URL;
if (!url?.startsWith("file:") || url === "file::memory:" || !process.argv[2])
  throw new Error(
    "Restore is restricted to a new local file database. Supply the SQL snapshot path."
  );
const exists = await stat(url.slice(5)).then(
  () => true,
  () => false
);
if (exists) throw new Error("Refusing to overwrite an existing database. Restore into a new file.");
const client = createClient({ url });
try {
  await client.executeMultiple(await readFile(process.argv[2], "utf8"));
  const integrity = await client.execute("PRAGMA integrity_check");
  const foreignKeys = await client.execute("PRAGMA foreign_key_check");
  if (integrity.rows[0].integrity_check !== "ok" || foreignKeys.rows.length)
    throw new Error("Restored database failed integrity validation.");
  console.log("Local restore verified. Review contents before promoting any recovery snapshot.");
} finally {
  client.close();
}
