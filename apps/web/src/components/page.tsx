import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// A page's main landmark: one column, phone width up, with the page's sections spaced apart.
export function Page({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      className={cn("mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6", className)}
      {...props}
    />
  );
}
