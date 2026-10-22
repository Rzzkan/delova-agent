import { createMcpHandler } from "mcp-handler";
import { isAuthorized } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { registerTools } from "@/lib/tools";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const handler = createMcpHandler(
  (server) => registerTools(server),
  { serverInfo: { name: "shopee-agent", version: "0.2.0" } },
  { basePath: "/api", maxDuration: 60, disableSse: true, verboseLogs: false },
);

async function guarded(req: Request): Promise<Response> {
  if (!isAuthorized(req, loadConfig().mcpSecret)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="shopee-agent"' },
    });
  }
  return handler(req);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
