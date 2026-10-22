import type { ReactNode } from "react";

export const metadata = { title: "Shopee Agent", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: "40rem", margin: "4rem auto", padding: "0 1rem" }}>
        {children}
      </body>
    </html>
  );
}
