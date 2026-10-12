import { findPendingInvite } from "@troba/core";
import type { Metadata } from "next";
import { connection } from "next/server";
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
      <main>
        <h1>This invite link doesn&apos;t work</h1>
        <p>It may have expired, been used or been revoked. Ask whoever sent it for a new one.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Join troba</h1>
      <SignUpForm token={token} email={invite.email} />
    </main>
  );
}
