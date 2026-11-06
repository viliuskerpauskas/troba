import type { Metadata } from "next";
import { Cal_Sans, Outfit } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { gitSha } from "@/server/env";
import "./globals.css";

// next/font downloads both at build time and serves them from troba itself, so the browser never
// calls Google and the CSP's font-src 'self' holds. Cal Sans is for headings, Outfit for the rest.
const outfit = Outfit({ subsets: ["latin", "latin-ext"], variable: "--font-outfit" });
const calSans = Cal_Sans({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  variable: "--font-cal-sans",
  // next/font has no metrics for Cal Sans, so it can't size a fallback to match and warns on
  // every compile; fall back to the system sans as it is.
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "troba",
  description: "Self-hosted personal hub",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // GIT_SHA is set only in the image's runtime stage, so pages are rendered per request rather
  // than prerendered at build time, where the footer would say "dev".
  await connection();

  return (
    <html lang="en" className={`${outfit.variable} ${calSans.variable}`}>
      <body className="flex min-h-dvh flex-col">
        {children}
        <footer className="mt-auto px-4 py-6 text-center text-xs text-muted-foreground">
          Version {gitSha()}
        </footer>
      </body>
    </html>
  );
}
