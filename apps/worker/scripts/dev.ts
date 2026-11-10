// `pnpm --filter @troba/worker dev`: bundles the worker, runs it, and on any change to a file in
// the bundle (the worker's or the packages' sources) rebuilds and restarts it.
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { context } from "esbuild";
import { workerBuildOptions } from "./build.ts";

const options = workerBuildOptions(path.join(import.meta.dirname, "../dist/dev"));
let child: ChildProcess | undefined;

async function stopChild() {
  const running = child;
  child = undefined;
  if (!running || running.exitCode !== null) return;
  const exited = new Promise((resolve) => running.once("exit", resolve));
  running.kill("SIGTERM");
  await exited;
}

const ctx = await context({
  ...options,
  plugins: [
    {
      name: "restart",
      setup(build) {
        build.onEnd(async (result) => {
          // A failed build keeps the last good worker running; esbuild prints the errors.
          if (result.errors.length > 0) return;
          await stopChild();
          // Inherits the env, which the dev script's --env-file flags loaded.
          child = spawn(process.execPath, [options.outfile], { stdio: "inherit" });
        });
      },
    },
  ],
});
await ctx.watch();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await ctx.dispose();
    await stopChild();
    process.exit(0);
  });
}
