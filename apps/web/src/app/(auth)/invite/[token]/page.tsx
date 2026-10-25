import { findPendingInvite } from "@troba/core";
import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { db } from "@/server/db";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Join troba",
  robots: { index: false, follow: false },
};

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  // Validity changes over time (expiry, use, revocation), so never prerender or cache this.
  await connection();
  const invite = await findPendingInvite(db(), token);

  // Unknown, expired, used and revoked invites all get this same page.
  if (!invite) {
    return (
      <AuthCard title="This invite link doesn't work">
        <p className="text-muted-foreground">
          It may have expired, been used or been revoked. Ask whoever sent it for a new one.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Join troba">
      <SignUpForm token={token} email={invite.email} />
    </AuthCard>
  );
}
