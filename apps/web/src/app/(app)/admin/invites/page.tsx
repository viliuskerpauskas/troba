import { listInvites } from "@troba/core";
import type { Metadata } from "next";
import { DescriptionList } from "@/components/description-list";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <Page>
      <h1>Invites</h1>
      <CreateInviteForm />

      <h2 id="all-invites">All invites</h2>
      {invites.length === 0 ? (
        <p className="text-muted-foreground">No invites yet.</p>
      ) : (
        // A list, not a table, so it fits a phone screen; each field keeps its label (dt).
        <ul aria-labelledby="all-invites" className="flex flex-col gap-3">
          {invites.map((invite) => (
            <li key={invite.id}>
              <Card size="sm">
                <CardContent className="flex flex-col gap-3">
                  <h3 id={`invite-${invite.id}`} className="[overflow-wrap:anywhere]">
                    {invite.email ?? "Anyone with the link"}
                  </h3>
                  <DescriptionList>
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
                  </DescriptionList>
                  {invite.status === "pending" && (
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="id" value={invite.id} />
                      {/* Described by its heading, so each Revoke names its invite. */}
                      <Button
                        type="submit"
                        variant="outline"
                        aria-describedby={`invite-${invite.id}`}
                      >
                        Revoke
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
