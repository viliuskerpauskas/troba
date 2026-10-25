import { listUsers } from "@troba/core";
import type { Metadata } from "next";
import { DescriptionList } from "@/components/description-list";
import { Page } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/session";
import { DisableToggle, ResetLinkForm, resetLinksContainerId } from "./user-actions";

export const metadata: Metadata = { title: "Users · troba" };

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

function Day({ value }: { value: Date | null }) {
  return value ? <time dateTime={value.toISOString()}>{date.format(value)}</time> : "Never";
}

// The element showing a user's email, which describes their action buttons.
const emailId = (userId: string) => `user-${userId}-email`;

// Accounts only (SPEC-identity I6): no admin view of anyone's data and no impersonation.
export default async function UsersPage() {
  const admin = await requireAdmin();
  const users = await listUsers(db());

  return (
    <Page>
      <h1 id="users-heading">Users</h1>
      {/* A list, not a table: seven columns don't fit a phone screen, and each field keeps its
          label (dt) for screen readers. */}
      <ul aria-labelledby="users-heading" className="flex flex-col gap-3">
        {users.map((user) => (
          <li key={user.id}>
            <Card size="sm">
              <CardContent className="flex flex-col gap-3">
                <h2 className="text-base">
                  {user.name}
                  {user.id === admin.userId && " (you)"}
                </h2>
                <DescriptionList>
                  <dt>Email</dt>
                  <dd id={emailId(user.id)}>{user.email}</dd>
                  <dt>Role</dt>
                  <dd>{user.role}</dd>
                  <dt>Status</dt>
                  <dd>{user.disabled ? "disabled" : "active"}</dd>
                  <dt>Created</dt>
                  <dd>
                    <Day value={user.createdAt} />
                  </dd>
                  <dt>Last active</dt>
                  <dd>
                    <Day value={user.lastActiveAt} />
                  </dd>
                </DescriptionList>
                {user.id !== admin.userId && (
                  <div className="flex flex-wrap items-start gap-2">
                    {/* Keyed on the status, so a toggle starts without the previous answer. */}
                    <DisableToggle
                      key={String(user.disabled)}
                      userId={user.id}
                      emailId={emailId(user.id)}
                      disabled={user.disabled}
                    />
                    <ResetLinkForm userId={user.id} email={user.email} emailId={emailId(user.id)} />
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <div id={resetLinksContainerId} />
    </Page>
  );
}
