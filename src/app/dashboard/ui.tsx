import type { ReactNode } from "react";

export const TZ = "Asia/Jakarta";
export const fmt = (ms: number) =>
  new Date(ms).toLocaleString("id-ID", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtDay = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString("id-ID", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { timeZone: TZ });
export const rp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export const PLATFORM: Record<string, { label: string; connect: string }> = {
  shopee: { label: "Shopee", connect: "/api/shopee/connect" },
  tiktok: { label: "TikTok Shop", connect: "/api/tiktok/connect" },
};

export type Tone = "ok" | "warn" | "bad" | "info" | "mute";
export const BTN = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-default disabled:opacity-50";
export const BTN_PRIMARY = "bg-brand-500 text-white shadow-theme-xs hover:bg-brand-600";
export const BTN_DEFAULT = "bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/5";
export const BTN_DANGER = "bg-white text-error-600 ring-1 ring-inset ring-error-500/40 hover:bg-error-50 dark:bg-gray-800 dark:hover:bg-error-500/10";
export const TONE: Record<Tone, string> = {
  ok: "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
  warn: "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500",
  bad: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500",
  info: "bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400",
  mute: "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-400",
};

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[(tone as Tone) in TONE ? (tone as Tone) : "mute"]}`}>{children}</span>;
}
export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">{children}</div>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{children}</p>;
}
export function Note({ tone, children }: { tone: "warn"; children: ReactNode }) {
  return <div className={`mt-3 rounded-lg px-4 py-2.5 text-sm ${TONE[tone]}`}>{children}</div>;
}
export function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h2>
        {sub && <p className="text-sm text-gray-500 dark:text-gray-400">{sub}</p>}
      </div>
      <span className="flex-1" />
      {action}
    </div>
  );
}
export function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" }) {
  const color = tone === "warn" ? "text-warning-600" : tone === "bad" ? "text-error-600" : "text-gray-900 dark:text-white";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
export function Logo() {
  return (
    <div className="grid size-10 place-items-center rounded-xl bg-brand-500 text-lg font-bold text-white">M</div>
  );
}

