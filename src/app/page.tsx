import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config";
import { COOKIE, hasSession } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

/** Beranda tidak menampilkan apa pun: sudah masuk -> /dashboard, belum -> /login. */
export default async function Home() {
  const c = (await cookies()).get(COOKIE)?.value;
  redirect(hasSession(c, loadConfig().mcpSecret) ? "/dashboard" : "/login");
}
