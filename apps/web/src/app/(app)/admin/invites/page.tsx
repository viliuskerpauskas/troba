import { listInvites } from "@troba/core";
import type { Metadata } from "next";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/session";
import { revokeInviteAction } from "./actions";
import { CreateInviteForm } from "./create-invite-form";

export const metadata: Metadata = { title: "Invites · troba" };

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

function Time({ value }: { value: Date | null }) {
  return value ? <time dateTime={value.toISOString()}>{dateTime.format(value)}</time> : null;
}

export default async function InvitesPage() {
  await requireAdmin();
  const invites = await listInvites(db());

  return (
    <main>
      <h1>Invites</h1>
      <CreateInviteForm />

      <h2>All invites</h2>
      {invites.length === 0 ? (
        <p>No invites yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">Expires</th>
              <th scope="col">Used</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => (
              <tr key={invite.id}>
                <td>{invite.email ?? "Anyone with the link"}</td>
                <td>{invite.status}</td>
                <td>
                  <Time value={invite.createdAt} />
                </td>
                <td>
                  <Time value={invite.expiresAt} />
                </td>
                <td>
                  <Time value={invite.usedAt} />
                </td>
                <td>
                  {invite.status === "pending" && (
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="id" value={invite.id} />
                      <button type="submit">Revoke</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
