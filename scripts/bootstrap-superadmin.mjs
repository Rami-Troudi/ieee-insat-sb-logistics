import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
if (!url || !email) throw new Error("Set TURSO_DATABASE_URL and SUPERADMIN_EMAIL.");
if (/ieee[-_]?ras[-_]?insat/i.test(url)) throw new Error("Refusing to modify the RAS database.");
if (!url.startsWith("file:") && process.env.CONFIRM_SB_DATABASE !== "true") {
  throw new Error(
    "For a remote database, set CONFIRM_SB_DATABASE=true after checking the separate SB database URL."
  );
}

const client = createClient({ url, authToken });
try {
  const result = await client.execute({
    sql: "UPDATE user SET role='SUPERADMIN',updatedAt=? WHERE lower(email)=?",
    args: [Date.now(), email],
  });
  if (Number(result.rowsAffected) !== 1) {
    throw new Error(
      "No matching user was updated. The user must sign in once before superadmin access can be assigned."
    );
  }
  console.log("Superadmin role assigned to " + email + ".");
} finally {
  client.close();
}
