import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { gitSha } from "@/server/env";

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
      <body>
        {children}
        <footer>Version {gitSha()}</footer>
      </body>
    </html>
  );
}
