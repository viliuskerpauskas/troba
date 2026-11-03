import Link from "next/link";
import { redirect } from "next/navigation";
import { Page } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { currentUser } from "@/server/session";

export default async function HomePage() {
  if (await currentUser()) redirect("/money");

  return (
    <Page className="max-w-sm py-12">
      <h1>troba</h1>
      <p className="text-muted-foreground">Personal hub.</p>
      <Link href="/sign-in" className={buttonVariants({ className: "self-start" })}>
        Sign in
      </Link>
    </Page>
  );
}
