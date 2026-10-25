import { NextResponse } from "next/server";
import { oauthState, safeEqual } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { TikTokClient } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Redirect URL aplikasi TikTok Shop (isi di Partner Center): menukar code menjadi token dan menyimpan toko. */
export async function GET(req: Request) {
  const cfg = loadConfig();
  const q = new URL(req.url).searchParams;
  if (!cfg.mcpSecret || !safeEqual(q.get("state") ?? "", oauthState(cfg.mcpSecret))) {
    return page("Ditolak", "State tidak valid. Mulai ulang dari dashboard (Hubungkan TikTok Shop).", 400);
  }
  const code = q.get("code");
  if (!code) return page("Gagal", "Respons TikTok tidak berisi code.", 400);
  try {
    const { shops } = await new TikTokClient(cfg).exchangeCode(code);
    const names = shops.map((s) => `<b>${esc(s.shop_name ?? s.shop_id)}</b> (${esc(s.region ?? "?")})`).join(", ");
    return page("Toko TikTok terhubung", `${names || "Tidak ada toko pada otorisasi ini"}. Kembali ke dashboard atau Claude.`);
  } catch (e) {
    return page("Gagal", esc(e instanceof Error ? e.message : String(e)), 500);
  }
}
