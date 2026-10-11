import { pingDb } from "@troba/db";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { checkHealth } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const { httpStatus, body } = await checkHealth(env().GIT_SHA, () => pingDb(db()));
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
