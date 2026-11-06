import { redirect } from "next/navigation";
import { currentUser } from "@/server/session";
import { SignInScreen } from "./(auth)/sign-in/sign-in-screen";

export default async function HomePage() {
  if (await currentUser()) redirect("/money");

  return <SignInScreen />;
}
