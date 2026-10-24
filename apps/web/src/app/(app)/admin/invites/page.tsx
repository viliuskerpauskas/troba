import { listInvites } from "@troba/core";
import type { Metadata } from "next";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/session";
import { revokeInviteAction } from "./actions";
import { CreateInviteForm } from "./create-invite-form";

export const metadata: Metadata = { title: "Invites · troba" };

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

function Time({ value }: { value: Date | null }) {
  return value ? <time dateTime={value.toISOString()}>{dateTime.format(value)}</time> : "Never";
}

export default async function InvitesPage() {
  await requireAdmin();
  const invites = await listInvites(db());

  return (
    <main>
      <h1>Invites</h1>
      <CreateInviteForm />

      <h2 id="all-invites">All invites</h2>
      {invites.length === 0 ? (
        <p>No invites yet.</p>
      ) : (
        // A list, not a table, so it fits a phone screen; each field keeps its label (dt).
        <ul aria-labelledby="all-invites">
          {invites.map((invite) => (
            <li key={invite.id}>
              <h3 style={{ overflowWrap: "anywhere" }}>{invite.email ?? "Anyone with the link"}</h3>
              <dl>
                <dt>Status</dt>
                <dd>{invite.status}</dd>
                <dt>Created</dt>
                <dd>
                  <Time value={invite.createdAt} />
                </dd>
                <dt>Expires</dt>
                <dd>
                  <Time value={invite.expiresAt} />
                </dd>
                <dt>Used</dt>
                <dd>
                  <Time value={invite.usedAt} />
                </dd>
              </dl>
              {invite.status === "pending" && (
                <form action={revokeInviteAction}>
                  <input type="hidden" name="id" value={invite.id} />
                  <button type="submit">Revoke</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
