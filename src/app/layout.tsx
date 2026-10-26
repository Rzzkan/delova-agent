import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Delova Agent", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
