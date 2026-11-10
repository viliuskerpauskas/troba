// `pnpm --filter @troba/worker dev`: bundles the worker and runs it. The dev script's
// `node --watch-path` restarts this whole process when the worker's or packages' sources change.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildWorker } from "./build.ts";

const outfile = await buildWorker(path.join(import.meta.dirname, "../dist/dev"));
await import(pathToFileURL(outfile).href);
