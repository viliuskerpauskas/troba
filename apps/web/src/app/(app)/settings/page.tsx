import type { Metadata } from "next";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
    <Page>
      <h1>Settings</h1>

      <section aria-labelledby="profile">
        <Card>
          <CardHeader>
            <h2 id="profile">Profile</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="[overflow-wrap:anywhere]">Email: {profile.email}</p>
            <NameForm name={profile.name} />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="password">
        <Card>
          <CardHeader>
            <h2 id="password">Password</h2>
          </CardHeader>
          <CardContent>
            <PasswordForm minLength={passwordLength.min} maxLength={passwordLength.max} />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="sessions">
        <Card>
          <CardHeader>
            <h2 id="sessions">Sessions</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col divide-y">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0"
                >
                  <span>
                    {session.device}
                    {session.current ? " (this device)" : ""}
                    {session.ipAddress ? `, from ${session.ipAddress}` : ""}, last active{" "}
                    <time dateTime={session.lastActive.toISOString()}>
                      {dateFormat.format(session.lastActive)}
                    </time>{" "}
                  </span>
                  {!session.current && (
                    <form action={revoke}>
                      <input type="hidden" name="sessionId" value={session.id} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        aria-label={`Sign out ${session.device}`}
                      >
                        Sign out
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <form action={signOutAll}>
              <Button type="submit" variant="outline">
                Sign out everywhere
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="delete-account">
        <Card>
          <CardHeader>
            <h2 id="delete-account">Delete account</h2>
          </CardHeader>
          <CardContent>
            <DeleteAccountForm email={profile.email} />
          </CardContent>
        </Card>
      </section>
    </Page>
  );
}
