import { pingDb } from "@troba/db";
import { db } from "@/server/db";
import { gitSha } from "@/server/env";
import { checkHealth } from "@/server/health";

export async function GET() {
  // db() runs inside the check, so a missing or invalid DATABASE_URL is a 503 too.
  const { httpStatus, body } = await checkHealth(gitSha(), () => pingDb(db()));
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
