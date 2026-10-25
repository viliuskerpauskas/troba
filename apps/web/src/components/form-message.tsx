import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// A form's answer: an error (role alert) or a confirmation (role status), announced when shown.
export function FormError({ className, ...props }: ComponentProps<"p">) {
  return <p role="alert" className={cn("text-sm text-destructive", className)} {...props} />;
}

export function FormStatus({ className, ...props }: ComponentProps<"p">) {
  return <p role="status" className={cn("text-sm", className)} {...props} />;
}
