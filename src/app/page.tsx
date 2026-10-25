export default function Home() {
  return (
    <main className="narrow">
      <h1>Shopee Agent</h1>
      <p>Server MCP untuk mengelola toko Shopee dari chat Claude.</p>
      <p>
        Tambahkan <code>/api/mcp?key=…</code> sebagai custom connector di Claude. Panduan lengkap ada di README repo.
      </p>
      <p>
        <a href="/dashboard">Buka dashboard</a>
      </p>
    </main>
  );
}
