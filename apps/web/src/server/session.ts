import { schema } from "@troba/db";
import { headers } from "next/headers";
import { forbidden, redirect, unauthorized } from "next/navigation";
import { auth } from "./auth";

export type Role = schema.Role;
export type SessionUser = { userId: string; role: Role };

// Pages and server actions redirect to the sign-in page; /api/* route handlers answer 401.
type Caller = "page" | "api";

export async function currentUser(): Promise<SessionUser | null> {
  // headers() first: it marks the page dynamic before auth() reads env, which a build lacks.
  const requestHeaders = await headers();
  const session = await auth().api.getSession({ headers: requestHeaders });
  if (!session || session.user.banned) return null;
  return {
    userId: session.user.id,
    // The database only allows these two; anything else gets the fewest rights.
    role: session.user.role === "admin" ? "admin" : "user",
  };
}

// Call first in every page, server action and route handler that touches user data.
export async function requireUser(caller: Caller = "page"): Promise<SessionUser> {
  const user = await currentUser();
  if (user) return user;
  if (caller === "api") unauthorized();
  redirect("/sign-in");
}

export async function requireAdmin(caller: Caller = "page"): Promise<SessionUser> {
  const user = await requireUser(caller);
  if (user.role !== "admin") forbidden();
  return user;
}
