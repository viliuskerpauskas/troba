import { createHash, randomBytes } from "node:crypto";

// Link tokens (invites, password resets). The token only exists in the link; the database keeps
// its SHA-256 hash, so a database leak can't be used to redeem one.

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
