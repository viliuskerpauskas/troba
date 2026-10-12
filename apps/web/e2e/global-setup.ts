import { randomBytes } from "node:crypto";
import pg from "pg";
import { createAdmin } from "../src/server/create-admin";
import { db } from "../src/server/db";

export const adminEmail = "e2e-admin@example.test";

// A fresh admin with a random password on every run. Tests read the password from the env,
// which Playwright passes from global setup to the workers.
export default async function globalSetup() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("delete from users where email = $1", [adminEmail]);
    // Failed sign-ins from earlier runs would otherwise lock test users out for 15 minutes. All
    // tests share 127.0.0.1's limit of 5 failures; a test that fails more sets its own address.
    await client.query("delete from sign_in_attempts");
  } finally {
    await client.end();
  }

  const password = randomBytes(18).toString("base64");
  await createAdmin({ email: adminEmail, password, force: true });
  await db().$client.end();
  process.env.E2E_ADMIN_PASSWORD = password;
}
