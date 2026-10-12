import { findPendingPasswordReset } from "@troba/core";
import type { Metadata } from "next";
import { connection } from "next/server";
import { db } from "@/server/db";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  // Neutral, since an invalid link gets this page too.
  title: "Reset password · troba",
  robots: { index: false, follow: false },
};

export default async function ResetPage(props: PageProps<"/reset/[token]">) {
  const { token } = await props.params;
  // Validity changes over time (expiry, use), so never prerender or cache this.
  await connection();
  const reset = await findPendingPasswordReset(db(), token);

  // Unknown, expired and used links all get this same page.
  if (!reset) {
    return (
      <main>
        <h1>This reset link doesn&apos;t work</h1>
        <p>It may have expired or been used. Ask your admin for a new one.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Set a new password</h1>
      <p>For {reset.email}. Setting it signs you out everywhere.</p>
      <ResetForm token={token} email={reset.email} />
    </main>
  );
}
