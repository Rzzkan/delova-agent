import { storeKind } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Untuk healthcheck Docker / reverse proxy. Tanpa rahasia, tanpa menyentuh API marketplace. */
export function GET() {
  return Response.json({ ok: true, store: storeKind() });
}
