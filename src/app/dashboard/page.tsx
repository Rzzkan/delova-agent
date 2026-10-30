import DashboardClient from "./DashboardClient";

export const metadata = { title: "Dashboard · Marketplace Agent", robots: { index: false, follow: false } };

export default function Page() {
  return <DashboardClient />;
}
