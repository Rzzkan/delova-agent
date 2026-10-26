import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config";
import { COOKIE, hasSession } from "@/lib/dashboard";
import LoginForm from "./LoginForm";

export const metadata = { title: "Masuk · Delova Agent", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function Page() {
  const c = (await cookies()).get(COOKIE)?.value;
  if (hasSession(c, loadConfig().mcpSecret)) redirect("/dashboard");
  return <LoginForm />;
}
