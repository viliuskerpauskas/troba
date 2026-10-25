import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { gitSha } from "@/server/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "troba",
  description: "Self-hosted personal hub",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // GIT_SHA is set only in the image's runtime stage, so pages are rendered per request rather
  // than prerendered at build time, where the footer would say "dev".
  await connection();

  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        {children}
        <footer className="mt-auto px-4 py-6 text-center text-xs text-muted-foreground">
          Version {gitSha()}
        </footer>
      </body>
    </html>
  );
}
