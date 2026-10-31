import SettingsClient from "./SettingsClient";

export const metadata = { title: "Pengaturan AI · Marketplace Agent", robots: { index: false, follow: false } };

export default function Page() {
  return <SettingsClient />;
}
