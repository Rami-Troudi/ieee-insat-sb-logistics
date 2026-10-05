import { createClient } from "@libsql/client";
import { writeFile } from "node:fs/promises";

const url = process.env.TURSO_DATABASE_URL;
const output = process.argv[2];
if (!url || !output) throw new Error("Set TURSO_DATABASE_URL and supply a backup destination.");
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const literal = (value) =>
  value === null
    ? "NULL"
    : typeof value === "string"
      ? "'" + value.replaceAll("'", "''") + "'"
      : value instanceof ArrayBuffer || ArrayBuffer.isView(value)
        ? "X'" +
          Buffer.from(
            value instanceof ArrayBuffer ? value : value.buffer,
            value.byteOffset ?? 0,
            value.byteLength
          ).toString("hex") +
          "'"
        : String(value);
const transaction = await client.transaction("read");
try {
  const schema = (
    await transaction.execute(
      "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name"
    )
  ).rows;
  const statements = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  for (const row of schema.filter((row) => row.type === "table")) {
    statements.push(row.sql + ";");
    const result = await transaction.execute(`SELECT * FROM ${quote(row.name)}`);
    for (const values of result.rows)
      statements.push(
        `INSERT INTO ${quote(row.name)} (${result.columns.map(quote).join(",")}) VALUES (${result.columns.map((column) => literal(values[column])).join(",")});`
      );
  }
  for (const row of schema.filter((row) => row.type !== "table")) statements.push(row.sql + ";");
  statements.push("COMMIT;", "PRAGMA foreign_keys=ON;");
  // Refuse overwriting an earlier recovery point.
  await writeFile(output, statements.join("\n") + "\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await transaction.commit();
  console.log(
    "Consistent database snapshot saved. Store it securely: it contains account and loan data."
  );
} catch (error) {
  await transaction.rollback();
  throw error;
} finally {
  transaction.close();
  client.close();
}
