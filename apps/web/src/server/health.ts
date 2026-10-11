export type HealthBody =
  | { status: "ok"; version: string; db: "ok" }
  | { status: "error"; version: string; db: "unreachable" };

export async function checkHealth(
  version: string,
  pingDb: () => Promise<unknown>,
  timeoutMs = 2_000,
): Promise<{ httpStatus: 200 | 503; body: HealthBody }> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("health check timed out")), timeoutMs);
  });
  try {
    await Promise.race([pingDb(), deadline]);
    return { httpStatus: 200, body: { status: "ok", version, db: "ok" } };
  } catch {
    // Deliberately swallowed: the response must not leak error details.
    return { httpStatus: 503, body: { status: "error", version, db: "unreachable" } };
  } finally {
    clearTimeout(timer);
  }
}
