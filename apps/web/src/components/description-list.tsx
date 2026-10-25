import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Label and value pairs (dt then dd) in two columns. A long value, such as an email, wraps
// anywhere so it fits a phone screen.
export function DescriptionList({ className, ...props }: ComponentProps<"dl">) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
