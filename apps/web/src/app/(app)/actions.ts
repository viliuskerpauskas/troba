"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";

// Ends the current session only; other devices stay signed in.
export async function signOut() {
  await auth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
