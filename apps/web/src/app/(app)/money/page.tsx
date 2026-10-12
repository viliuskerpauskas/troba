import type { Metadata } from "next";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Money · troba" };

export default async function MoneyPage() {
  await requireUser();

  return (
    <main>
      <h1>Money</h1>
      <p>Nothing here yet.</p>
    </main>
  );
}
