import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · troba" };

export default async function SignInPage() {
  if (await currentUser()) redirect("/money");

  return (
    <main>
      <h1>Sign in</h1>
      <SignInForm />
    </main>
  );
}
