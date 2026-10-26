import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { loadConfig } from "@/lib/config";
import { COOKIE, hasSession } from "@/lib/dashboard";
import ThemeScript from "../ThemeScript";
import "./dashboard.css";

export const dynamic = "force-dynamic";

/** Semua halaman dashboard wajib login; belum masuk -> /login. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const c = (await cookies()).get(COOKIE)?.value;
  if (!hasSession(c, loadConfig().mcpSecret)) redirect("/login");
  return (
    <>
      <ThemeScript />
      {children}
    </>
  );
}
