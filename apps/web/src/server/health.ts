export type HealthBody =
  | { status: "ok"; version: string; db: "ok" }
  | { status: "error"; version: string; db: "unreachable" };

export async function checkHealth(
  version: string,
  pingDb: () => Promise<unknown>,
): Promise<{ httpStatus: 200 | 503; body: HealthBody }> {
  try {
    await pingDb();
    return { httpStatus: 200, body: { status: "ok", version, db: "ok" } };
  } catch {
    // Deliberately swallowed: the response must not leak error details.
    return { httpStatus: 503, body: { status: "error", version, db: "unreachable" } };
  }
}
