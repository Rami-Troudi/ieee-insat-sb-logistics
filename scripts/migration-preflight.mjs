export async function migrationPreflight(client) {
  const tables = new Set(
    (await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(
      (row) => row.name
    )
  );
  const problems = [];
  if (tables.has("reservation_assets")) {
    const duplicates = await client.execute(
      "SELECT asset_id,COUNT(*) AS count FROM reservation_assets WHERE state='BORROWED' GROUP BY asset_id HAVING COUNT(*)>1"
    );
    if (duplicates.rows.length)
      problems.push({ kind: "duplicate_active_borrowing", rows: duplicates.rows });
  }
  if (tables.has("account")) {
    const duplicates = await client.execute(
      "SELECT userId,providerId,COUNT(*) AS count FROM account GROUP BY userId,providerId HAVING COUNT(*)>1"
    );
    if (duplicates.rows.length)
      problems.push({ kind: "duplicate_provider_credentials", rows: duplicates.rows });
  }
  const foreignKeys = await client.execute("PRAGMA foreign_key_check");
  if (foreignKeys.rows.length)
    problems.push({ kind: "foreign_key_errors", rows: foreignKeys.rows });
  const integrity = await client.execute("PRAGMA integrity_check");
  if (integrity.rows.length !== 1 || integrity.rows[0].integrity_check !== "ok")
    problems.push({ kind: "integrity_errors", rows: integrity.rows });
  if (problems.length)
    throw new Error(
      "Migration preflight failed. Preserve the backup and resolve conflicts explicitly; no records were deleted. " +
        JSON.stringify(problems)
    );
}
