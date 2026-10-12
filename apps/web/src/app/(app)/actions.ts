"use server";

import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { authHeaders } from "@/server/session";

// Ends the current session only; other devices stay signed in.
export async function signOut() {
  await auth().api.signOut({ headers: await authHeaders() });
  redirect("/sign-in");
}
