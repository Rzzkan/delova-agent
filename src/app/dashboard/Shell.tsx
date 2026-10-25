"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { BTN, BTN_PRIMARY, Logo } from "./ui";

export type Section = "ringkasan" | "flashsale" | "voucher";

const ShellContext = createContext<{ unauthorized: () => void }>({ unauthorized: () => {} });
/** Dipanggil halaman anak bila API membalas 401, supaya kembali ke layar login. */
export const useShell = () => useContext(ShellContext);

const NAV: { id: string; label: string; href: string; section?: Section; icon: string }[] = [
  { id: "ringkasan", label: "Ringkasan", href: "/dashboard", section: "ringkasan", icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
  { id: "toko", label: "Toko terhubung", href: "/dashboard#toko", icon: "M3 9l1-5h16l1 5M4 9v11h16V9M9 20v-6h6v6" },
  { id: "flashsale", label: "Flash sale", href: "/dashboard/flash-sale", section: "flashsale", icon: "M13 2L4 14h7l-1 8 9-12h-7l1-8z" },
  { id: "voucher", label: "Voucher aktif", href: "/dashboard/voucher", section: "voucher", icon: "M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V8zM13 6v12" },
  { id: "antrian", label: "Antrian edit massal", href: "/dashboard#antrian", icon: "M4 6h16M4 12h16M4 18h10" },
];

export default function Shell({ active, children }: { active: Section; children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [dark, setDark] = useState(false);
  const [menu, setMenu] = useState(false);
  const [key, setKey] = useState("");
  const [loginErr, setLoginErr] = useState("");

  const probe = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard/session", { cache: "no-store" });
      setAuthed(r.ok);
    } catch {
      setAuthed(false);
    }
  }, []);
  useEffect(() => void probe(), [probe]);

  useEffect(() => {
    let d = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    try {
      const t = localStorage.getItem("da_theme");
      if (t) d = t === "dark";
    } catch {}
    setDark(d);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const toggleTheme = () =>
    setDark((v) => {
      try { localStorage.setItem("da_theme", v ? "light" : "dark"); } catch {}
      return !v;
    });

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr("");
    try {
      const r = await fetch("/api/dashboard/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: key }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setKey("");
      setAuthed(true);
    } catch (err) {
      setLoginErr(err instanceof Error ? err.message : String(err));
    }
  }
  async function logout() {
    await fetch("/api/dashboard/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
    setAuthed(false);
  }

  if (authed === null) return <div className="grid min-h-screen place-items-center text-sm text-gray-500">Memuat…</div>;

  if (!authed) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <form onSubmit={login} className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-7 shadow-theme-md dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-5 flex items-center gap-3">
            <Logo />
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Delova Agent</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Masuk ke dashboard</p>
            </div>
          </div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="Masukkan password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 shadow-theme-xs outline-none placeholder:text-gray-400 focus:border-brand-300 focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white"
          />
          <p className="mt-2 min-h-5 text-sm text-error-600">{loginErr}</p>
          <button type="submit" disabled={!key} className={`${BTN} ${BTN_PRIMARY} mt-2 h-11 w-full`}>Masuk</button>
        </form>
      </div>
    );
  }

  return (
    <ShellContext.Provider value={{ unauthorized: () => setAuthed(false) }}>
      <div className="min-h-screen">
        {menu && <div className="fixed inset-0 z-30 bg-gray-900/50 lg:hidden" onClick={() => setMenu(false)} />}
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-gray-200 bg-white px-5 py-6 transition-transform dark:border-gray-800 dark:bg-gray-900 lg:translate-x-0 ${menu ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="mb-8 flex items-center gap-3 px-1">
            <Logo />
            <div className="leading-tight">
              <div className="text-lg font-semibold text-gray-900 dark:text-white">Delova Agent</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Shopee &amp; TikTok Shop</div>
            </div>
          </div>
          <div className="mb-3 px-3 text-xs font-medium uppercase tracking-wider text-gray-400">Menu</div>
          <nav className="flex flex-col gap-1">
            {NAV.map((n) => {
              const on = n.section === active;
              return (
                <a
                  key={n.id}
                  href={n.href}
                  onClick={() => setMenu(false)}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-brand-50 hover:text-brand-500 dark:hover:bg-white/5 dark:hover:text-brand-400 ${on ? "bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400" : "text-gray-700 dark:text-gray-300"}`}
                >
                  <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon} /></svg>
                  {n.label}
                </a>
              );
            })}
          </nav>
          <div className="mt-auto rounded-xl bg-gray-50 p-4 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
            Ubah produk, flash sale, dan antrian paling mudah lewat chat Claude. Dashboard ini untuk memantau.
          </div>
        </aside>

        <div className="lg:pl-72">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90 sm:px-6">
            <button className="grid size-10 place-items-center rounded-lg border border-gray-200 text-gray-600 lg:hidden dark:border-gray-700 dark:text-gray-300" onClick={() => setMenu(true)} aria-label="Buka menu">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <span className="flex-1" />
            <button className="grid size-10 place-items-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5" onClick={toggleTheme} aria-label="Ganti tema" title={dark ? "Mode terang" : "Mode gelap"}>
              {dark ? (
                <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              ) : (
                <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></svg>
              )}
            </button>
            <button className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white" onClick={logout}>Keluar</button>
          </header>
          <main className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
