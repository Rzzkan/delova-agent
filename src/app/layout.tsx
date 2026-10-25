import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Shopee Agent", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
