import type { ReactNode } from "react";
import { Page } from "@/components/page";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// The signed-out pages: one narrow card under the page's heading.
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Page className="max-w-sm py-12">
      <Card>
        <CardHeader>
          <h1 className="text-xl">{title}</h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    </Page>
  );
}
