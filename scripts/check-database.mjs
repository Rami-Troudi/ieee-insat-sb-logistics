import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("Set TURSO_DATABASE_URL.");
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
try {
  await client.execute("PRAGMA foreign_keys = ON");
  const integrity = await client.execute("PRAGMA integrity_check");
  const foreignKeys = await client.execute("PRAGMA foreign_key_check");
  const duplicates = await client.execute(
    "SELECT asset_id FROM reservation_assets WHERE state='BORROWED' GROUP BY asset_id HAVING COUNT(*)>1"
  );
  const invalidLines = await client.execute(
    "SELECT ra.id FROM reservation_assets ra JOIN reservation_lines l ON l.id=ra.reservation_line_id JOIN assets a ON a.id=ra.asset_id WHERE ra.reservation_id<>l.reservation_id OR a.equipment_item_id<>l.equipment_item_id"
  );
  const inconsistentStock = await client.execute(
    "SELECT a.id FROM assets a WHERE (a.state='BORROWED')<>(EXISTS(SELECT 1 FROM reservation_assets ra WHERE ra.asset_id=a.id AND ra.state='BORROWED'))"
  );
  const counts = await client.execute(
    "SELECT (SELECT COUNT(*) FROM user) AS users,(SELECT COUNT(*) FROM equipment_items) AS equipmentTypes,(SELECT COUNT(*) FROM assets) AS assets,(SELECT COUNT(*) FROM reservations) AS reservations"
  );
  const ok =
    integrity.rows.length === 1 &&
    Object.values(integrity.rows[0])[0] === "ok" &&
    !foreignKeys.rows.length &&
    !duplicates.rows.length &&
    !invalidLines.rows.length &&
    !inconsistentStock.rows.length;
  console.log(
    JSON.stringify(
      {
        ok,
        integrity: integrity.rows.map((row) => Object.values(row)[0]),
        foreignKeyErrors: foreignKeys.rows.length,
        duplicateBorrowedAssets: duplicates.rows.length,
        invalidAssignments: invalidLines.rows.length,
        inconsistentStock: inconsistentStock.rows.length,
        counts: counts.rows[0],
      },
      null,
      2
    )
  );
  if (!ok) process.exitCode = 1;
} finally {
  client.close();
}
