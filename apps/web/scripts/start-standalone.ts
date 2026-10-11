// Runs the standalone build the way the production image will: `next build` leaves static
// assets (and public/, once there is one) outside .next/standalone, so copy them in first.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const app = path.join(import.meta.dirname, "..");
const server = path.join(app, ".next/standalone/apps/web");

if (!existsSync(path.join(server, "server.js"))) {
  throw new Error("No standalone build found. Run `pnpm build` first.");
}

cpSync(path.join(app, ".next/static"), path.join(server, ".next/static"), { recursive: true });
if (existsSync(path.join(app, "public"))) {
  cpSync(path.join(app, "public"), path.join(server, "public"), { recursive: true });
}

await import(pathToFileURL(path.join(server, "server.js")).href);
