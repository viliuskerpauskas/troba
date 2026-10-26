import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { currentUser } from "@/server/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · troba" };

export default async function SignInPage() {
  if (await currentUser()) redirect("/money");

  return (
    <AuthCard title="Sign in">
      <SignInForm />
    </AuthCard>
  );
}
