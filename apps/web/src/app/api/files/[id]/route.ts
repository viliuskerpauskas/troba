import { z } from "zod";
import { attachmentResponse } from "@/server/files";
import { requireUser } from "@/server/session";

// Anything but download=1 shows the file.
const Download = z.literal("1").nullable().catch(null);

// A receipt, for its owner only (SPEC-money M6). ?download=1 saves it instead of showing it.
export async function GET(request: Request, { params }: RouteContext<"/api/files/[id]">) {
  const { userId } = await requireUser("api");
  const download = Download.parse(new URL(request.url).searchParams.get("download")) === "1";
  return attachmentResponse(userId, (await params).id, { download });
}
