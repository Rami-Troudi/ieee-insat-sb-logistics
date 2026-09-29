import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export { schema };

export function createDatabase(client: Client) {
  return drizzle({ client, schema: schema.schema });
}

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createLibSqlClient(url: string, authToken?: string) {
  return createClient({ url, authToken });
}
