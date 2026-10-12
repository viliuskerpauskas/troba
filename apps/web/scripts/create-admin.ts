// Creates an admin account (SPEC-identity I1). The password is prompted, never an argument,
// so it stays out of shell history and process lists.
// Usage: create-admin <email> [--force]
//   local:  pnpm admin:create <email>
//   image:  node scripts/create-admin.js <email>
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { createAdmin } from "../src/server/create-admin";
import { db } from "../src/server/db";

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    // Piped input (automation, tests): the first line is the password.
    const lines = createInterface({ input: process.stdin });
    for await (const line of lines) {
      lines.close();
      return line;
    }
    return "";
  }

  // Readline handles line editing; its echo goes to a muted stream so the password isn't shown.
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const prompt = createInterface({ input: process.stdin, output: muted, terminal: true });
  prompt.on("SIGINT", () => {
    process.stdout.write("\n");
    process.exit(130);
  });
  const ask = async (question: string) => {
    process.stdout.write(question);
    const answer = await prompt.question("");
    process.stdout.write("\n");
    return answer;
  };
  try {
    const password = await ask("Password: ");
    if ((await ask("Repeat password: ")) !== password)
      throw new Error("The passwords don't match.");
    return password;
  } finally {
    prompt.close();
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { force: { type: "boolean", default: false } },
});
const [email] = positionals;
if (!email || positionals.length > 1) {
  console.error("usage: create-admin <email> [--force]");
  process.exit(2);
}

try {
  const password = await readPassword();
  await createAdmin({ email, password, force: values.force });
  await db().$client.end();
  console.log(`Admin created: ${email}`);
} catch (error) {
  console.error(`create-admin failed: ${error instanceof Error ? error.message : String(error)}`);
  // Exits even if the database pool is still open.
  process.exit(1);
}
