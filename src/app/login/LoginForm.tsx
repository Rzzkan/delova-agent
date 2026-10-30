"use client";

import { useState } from "react";
import { BTN, BTN_PRIMARY, Logo } from "../dashboard/ui";

export default function LoginForm() {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await fetch("/api/dashboard/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: key }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      window.location.href = "/dashboard";
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={login} className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-7 shadow-theme-md dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-5 flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Marketplace Agent</h1>
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
        <p className="mt-2 min-h-5 text-sm text-error-600">{err}</p>
        <button type="submit" disabled={!key || busy} className={`${BTN} ${BTN_PRIMARY} mt-2 h-11 w-full`}>{busy ? "Memeriksa…" : "Masuk"}</button>
      </form>
    </div>
  );
}
