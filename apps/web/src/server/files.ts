import { getAttachmentFile } from "@troba/core";
import { z } from "zod";
import { db } from "./db";
import { uploadsDir } from "./env";

// Serving a receipt (SPEC-money M6) to its owner, for /api/files/[id]. Anyone else gets the same
// 404 as for an id that doesn't exist, so an id says nothing about whether it's someone's file.

function notFound(): Response {
  return new Response("Not found.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// RFC 6266: a plain filename for old clients, with anything that could break the quoting
// replaced, and the exact name as RFC 5987 UTF-8.
function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function attachmentResponse(
  userId: string,
  attachmentId: string,
  options: { download?: boolean } = {},
): Promise<Response> {
  const id = z.uuid().safeParse(attachmentId);
  if (!id.success) return notFound();
  const file = await getAttachmentFile(db(), {
    userId,
    uploadsDir: uploadsDir(),
    attachmentId: id.data,
  });
  if (!file) return notFound();
  return new Response(file.bytes, {
    headers: {
      // The type sniffed at upload; nosniff stops the browser guessing another.
      "Content-Type": file.mime,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": contentDisposition(
        options.download ? "attachment" : "inline",
        file.filename,
      ),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
