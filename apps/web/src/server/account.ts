import {
  assertNever,
  beginSignInAttempt,
  deleteUser,
  signInLimit,
  signInSucceeded,
} from "@troba/core";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth, passwordLength } from "./auth";
import { clientIp } from "./client-ip";
import { db } from "./db";
import { uploadsDir } from "./env";
import { describeIpAddress } from "./ip-address";
import { describeDevice } from "./user-agent";

// Account settings (SPEC-identity I3, I4). Each function acts as the user whose session cookie
// is in the request headers; nothing here takes a user id from the caller.

// Input the user can fix; its message is safe to show them.
export class AccountInputError extends Error {}

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in.");
  }
}

export type SessionSummary = {
  id: string;
  device: string;
  // So the user can spot a session they don't recognise; see describeIpAddress.
  ipAddress: string | null;
  lastActive: Date;
  current: boolean;
};

const Name = z
  .string()
  .trim()
  .min(1, { error: "Enter a name." })
  .max(100, { error: "The name can have at most 100 characters." });

const NewPassword = z
  .string()
  .min(passwordLength.min, {
    error: `The new password needs at least ${passwordLength.min} characters.`,
  })
  .max(passwordLength.max, {
    error: `The new password can have at most ${passwordLength.max} characters.`,
  });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AccountInputError(result.error.issues[0]!.message);
  return result.data;
}

async function signedInSession(requestHeaders: Headers) {
  const session = await auth().api.getSession({ headers: requestHeaders });
  if (!session || session.user.banned) throw new NotSignedInError();
  return session;
}

export async function getProfile(
  requestHeaders: Headers,
): Promise<{ name: string; email: string }> {
  const { user } = await signedInSession(requestHeaders);
  return { name: user.name, email: user.email };
}

export async function changeName(requestHeaders: Headers, name: string): Promise<void> {
  await signedInSession(requestHeaders);
  const body = { name: parse(Name, name) };
  await auth().api.updateUser({ body, headers: requestHeaders });
}

// Signs out every other device (SPEC-identity I4): Better Auth deletes all the user's sessions
// and starts a new one for this device, whose cookie is in the returned headers; inside a server
// action nextCookies() also sets it on the response.
//
// Wrong current passwords count towards the sign-in limit (SPEC-identity I3): both guess the same
// password, and Better Auth's server API, unlike its HTTP endpoints, has no limiter of its own.
export async function changePassword(
  requestHeaders: Headers,
  input: { currentPassword: string; newPassword: string },
): Promise<{ headers: Headers }> {
  const { user } = await signedInSession(requestHeaders);
  const newPassword = parse(NewPassword, input.newPassword);
  const attempt = await beginSignInAttempt(db(), {
    email: user.email,
    ipAddress: clientIp(requestHeaders),
  });
  if (!attempt)
    throw new AccountInputError(
      `Too many wrong passwords. Wait ${signInLimit.windowMinutes} minutes and try again.`,
    );
  try {
    const { headers } = await auth().api.changePassword({
      body: { currentPassword: input.currentPassword, newPassword, revokeOtherSessions: true },
      headers: requestHeaders,
      returnHeaders: true,
    });
    await signInSucceeded(db(), attempt);
    return { headers };
  } catch (error) {
    if (error instanceof APIError && error.body?.code === "INVALID_PASSWORD") {
      throw new AccountInputError("The current password is incorrect.");
    }
    throw error;
  }
}

// Reads the table directly: Better Auth's listSessions only answers for a session created in
// the last day, and settings must work for the whole 30-day session.
export async function listSessions(requestHeaders: Headers): Promise<SessionSummary[]> {
  const { session: current, user } = await signedInSession(requestHeaders);
  const sessions = await db().query.sessions.findMany({
    columns: { id: true, userAgent: true, ipAddress: true, updatedAt: true },
    where: (sessions, { and, eq, gt }) =>
      and(eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date())),
    orderBy: (sessions, { desc }) => [desc(sessions.updatedAt)],
  });
  return sessions.map((session) => ({
    id: session.id,
    device: describeDevice(session.userAgent),
    ipAddress: describeIpAddress(session.ipAddress),
    // Better Auth refreshes a session at most once a day (updateAge), so this is day-accurate.
    lastActive: session.updatedAt,
    current: session.id === current.id,
  }));
}

// Silently ignores ids that aren't one of the user's sessions.
export async function revokeSession(requestHeaders: Headers, sessionId: string): Promise<void> {
  const { user } = await signedInSession(requestHeaders);
  const id = z.uuid().safeParse(sessionId);
  if (!id.success) return;
  const session = await db().query.sessions.findFirst({
    columns: { token: true },
    where: (sessions, { and, eq }) => and(eq(sessions.id, id.data), eq(sessions.userId, user.id)),
  });
  if (!session) return;
  await auth().api.revokeSession({ body: { token: session.token }, headers: requestHeaders });
}

export async function signOutEverywhere(requestHeaders: Headers): Promise<void> {
  await signedInSession(requestHeaders);
  await auth().api.revokeSessions({ headers: requestHeaders });
  // The session is already gone; this clears its cookie.
  await auth().api.signOut({ headers: requestHeaders });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Irreversible (SPEC-identity I4): the user confirms by typing their own email. Their rows,
// sessions and uploads/<userId>/ are deleted; the last admin is refused.
export async function deleteAccount(requestHeaders: Headers, confirmEmail: string): Promise<void> {
  const { user } = await signedInSession(requestHeaders);
  if (normalizeEmail(confirmEmail) !== normalizeEmail(user.email)) {
    throw new AccountInputError("Type your email exactly as shown to confirm.");
  }
  const result = await deleteUser(db(), { userId: user.id, uploadsDir: uploadsDir() });
  if (!result.ok) {
    switch (result.reason) {
      case "last-admin":
        throw new AccountInputError(
          "You're the only admin. Make someone else an admin before deleting your account.",
        );
      case "not-found":
        throw new NotSignedInError();
      default:
        assertNever(result.reason);
    }
  }
  // The session row went with the user; this clears its cookie.
  await auth().api.signOut({ headers: requestHeaders });
}
