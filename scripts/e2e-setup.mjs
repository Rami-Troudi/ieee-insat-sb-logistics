import { createClient } from "@libsql/client";
import { serializeSignedCookie } from "better-call";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const url = process.env.TURSO_DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;
const origin = process.env.APP_ORIGIN;
if (
  !url?.startsWith("file:") ||
  !url.replaceAll("\\", "/").endsWith("/.local/e2e.db") ||
  !secret ||
  !origin
) {
  throw new Error("E2E setup requires the isolated local database, test secret, and app origin.");
}
const databasePath = url.slice("file:".length);
const sessionsPath = resolve(".local/e2e-sessions.json");
await mkdir(dirname(databasePath), { recursive: true });
await rm(databasePath, { force: true });
const client = createClient({ url });
try {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.executeMultiple(await readFile(resolve("drizzle/0000_sb_reservations.sql"), "utf8"));
  const now = Date.now();
  const result = {};
  for (const [id, name, role] of [
    ["e2e-member", "Alex Member", "USER"],
    ["e2e-board", "Sam Board", "BOARD"],
  ]) {
    const email = id + "@example.test";
    await client.execute({
      sql: "INSERT INTO user(id,name,email,emailVerified,role,createdAt,updatedAt) VALUES(?,?,?,1,?,?,?)",
      args: [id, name, email, role, now, now],
    });
    const token = "token-" + id;
    await client.execute({
      sql: "INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)",
      args: ["session-" + id, now + 8 * 60 * 60_000, token, now, now, id],
    });
    const cookie = await serializeSignedCookie("better-auth.session_token", token, secret, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
    result[role === "USER" ? "memberCookie" : "boardCookie"] = cookie.split(";")[0];
  }
  await client.execute({
    sql: "INSERT INTO equipment_items(id,name,description,category,image_url,active,created_at,updated_at) VALUES(?,?,?,'Measurement','/equipment/multimeter.svg',1,?,?)",
    args: ["e2e-meter", "E2E Digital Multimeter", "Seeded for browser verification.", now, now],
  });
  const qrToken = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  await client.execute({
    sql: "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('e2e-asset','e2e-meter','E2E-METER-01',?,'AVAILABLE',1,?,?)",
    args: [qrToken, now, now],
  });
  const secondQrToken = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  await client.execute({
    sql: "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES('e2e-asset-02','e2e-meter','E2E-METER-02',?,'AVAILABLE',1,?,?)",
    args: [secondQrToken, now, now],
  });
  await client.execute({
    sql: "INSERT INTO chapters(id,name,short_code,active,created_at,updated_at) VALUES('e2e-chapter','Robotics Club','ROBO',1,?,?)",
    args: [now, now],
  });
  result.qrToken = qrToken;
  await writeFile(sessionsPath, JSON.stringify(result), { mode: 0o600 });
} finally {
  client.close();
}
