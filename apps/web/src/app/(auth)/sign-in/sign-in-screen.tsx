import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PegboardBackground } from "@/components/pegboard/pegboard-background";
import { SignInForm } from "./sign-in-form";

// The signed-out front door, at / and at /sign-in: the sign-in card over the pegboard.
export function SignInScreen() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <PegboardBackground />
      <p data-pegboard-calm className="self-center font-heading text-4xl tracking-tight">
        troba
      </p>
      <Card className="shadow-lg shadow-foreground/5">
        <CardHeader>
          <h1 className="text-xl">Sign in</h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SignInForm />
        </CardContent>
      </Card>
    </main>
  );
}
