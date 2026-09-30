import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { hashPassword } from "better-auth/crypto";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.SUPERADMIN_NAME?.trim() || "SB Administrator";
if (!url || !email) throw new Error("Set TURSO_DATABASE_URL and SUPERADMIN_EMAIL.");
if (/ieee[-_]?ras[-_]?insat/i.test(url)) throw new Error("Refusing to modify the RAS database.");
if (!url.startsWith("file:") && process.env.CONFIRM_SB_DATABASE !== "true") {
  throw new Error("Set CONFIRM_SB_DATABASE=true after checking the separate SB database URL.");
}

const client = createClient({ url, authToken });
const password = process.env.SUPERADMIN_PASSWORD || randomBytes(24).toString("base64url");
const passwordHash = await hashPassword(password);
const now = Date.now();
try {
  await client.execute("PRAGMA foreign_keys = ON");
  const existing = await client.execute({
    sql: "SELECT id FROM user WHERE lower(email)=?",
    args: [email],
  });
  const userId = existing.rows[0]?.id?.toString() ?? randomUUID();
  const statements = [];
  if (existing.rows.length) {
    statements.push({
      sql: "UPDATE user SET role='SUPERADMIN',emailVerified=1,updatedAt=? WHERE id=?",
      args: [now, userId],
    });
  } else {
    statements.push({
      sql: "INSERT INTO user(id,name,email,emailVerified,role,createdAt,updatedAt) VALUES(?,?,?,1,'SUPERADMIN',?,?)",
      args: [userId, name, email, now, now],
    });
  }
  const account = await client.execute({
    sql: "SELECT id FROM account WHERE userId=? AND providerId='credential'",
    args: [userId],
  });
  if (account.rows.length) {
    statements.push({
      sql: "UPDATE account SET password=?,updatedAt=? WHERE id=?",
      args: [passwordHash, now, account.rows[0].id],
    });
  } else {
    statements.push({
      sql: "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,?,?,?)",
      args: [randomUUID(), userId, userId, passwordHash, now, now],
    });
  }
  await client.batch(statements, "write");
  console.log(`Superadmin email: ${email}`);
  console.log(`Generated password (shown once): ${password}`);
  console.log("Use Admin sign in. Running this command again replaces the previous password.");
} finally {
  client.close();
}
