/** Menerapkan tema (terang/gelap) sebelum halaman digambar, supaya tidak berkedip dan tidak bentrok dengan pengaturan perangkat. */
export default function ThemeScript() {
  const js = `try{var t=localStorage.getItem("da_theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
