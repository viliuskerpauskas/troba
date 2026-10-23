import type { Metadata } from "next";
import { getProfile, listSessions } from "@/server/account";
import { passwordLength } from "@/server/auth";
import { authHeaders, requireUser } from "@/server/session";
import { revoke, signOutAll } from "./actions";
import { DeleteAccountForm } from "./delete-account-form";
import { NameForm } from "./name-form";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Settings · troba" };

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default async function SettingsPage() {
  await requireUser();
  const requestHeaders = await authHeaders();
  const [profile, sessions] = await Promise.all([
    getProfile(requestHeaders),
    listSessions(requestHeaders),
  ]);

  return (
    <main>
      <h1>Settings</h1>

      <section aria-labelledby="profile">
        <h2 id="profile">Profile</h2>
        <p>Email: {profile.email}</p>
        <NameForm name={profile.name} />
      </section>

      <section aria-labelledby="password">
        <h2 id="password">Password</h2>
        <PasswordForm minLength={passwordLength.min} maxLength={passwordLength.max} />
      </section>

      <section aria-labelledby="sessions">
        <h2 id="sessions">Sessions</h2>
        <ul>
          {sessions.map((session) => (
            <li key={session.id}>
              {session.device}
              {session.current ? " (this device)" : ""}
              {session.ipAddress ? `, from ${session.ipAddress}` : ""}, last active{" "}
              <time dateTime={session.lastActive.toISOString()}>
                {dateFormat.format(session.lastActive)}
              </time>{" "}
              {!session.current && (
                <form action={revoke}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <button type="submit" aria-label={`Sign out ${session.device}`}>
                    Sign out
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <form action={signOutAll}>
          <button type="submit">Sign out everywhere</button>
        </form>
      </section>

      <section aria-labelledby="delete-account">
        <h2 id="delete-account">Delete account</h2>
        <DeleteAccountForm email={profile.email} />
      </section>
    </main>
  );
}
