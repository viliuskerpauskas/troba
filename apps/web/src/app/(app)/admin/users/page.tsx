import { listUsers } from "@troba/core";
import type { Metadata } from "next";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/session";
import { DisableToggle, ResetLinkForm, resetLinksContainerId } from "./user-actions";

export const metadata: Metadata = { title: "Users · troba" };

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

function Day({ value }: { value: Date | null }) {
  return value ? <time dateTime={value.toISOString()}>{date.format(value)}</time> : "Never";
}

// Accounts only (SPEC-identity I6): no admin view of anyone's data and no impersonation.
export default async function UsersPage() {
  const admin = await requireAdmin();
  const users = await listUsers(db());

  return (
    <main>
      <h1 id="users-heading">Users</h1>
      {/* A list, not a table: seven columns don't fit a phone screen, and each field keeps its
          label (dt) for screen readers. */}
      <ul aria-labelledby="users-heading">
        {users.map((user) => (
          <li key={user.id}>
            <h2>
              {user.name}
              {user.id === admin.userId && " (you)"}
            </h2>
            <dl>
              <dt>Email</dt>
              <dd style={{ overflowWrap: "anywhere" }}>{user.email}</dd>
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
            </dl>
            {user.id !== admin.userId && (
              <>
                {/* Keyed on the status, so a toggle starts without the previous answer. */}
                <DisableToggle
                  key={String(user.disabled)}
                  userId={user.id}
                  disabled={user.disabled}
                />
                <ResetLinkForm userId={user.id} email={user.email} />
              </>
            )}
          </li>
        ))}
      </ul>
      <div id={resetLinksContainerId} />
    </main>
  );
}
