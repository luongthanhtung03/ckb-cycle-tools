import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CKB Cycle Tools",
  description: "See what ran when a CKB testnet transaction was verified, and what it cost in cycles",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
