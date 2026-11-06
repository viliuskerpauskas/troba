import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/session";
import { SignInScreen } from "./sign-in-screen";

export const metadata: Metadata = { title: "Sign in · troba" };

export default async function SignInPage() {
  if (await currentUser()) redirect("/money");

  return <SignInScreen />;
}
