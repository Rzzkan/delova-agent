import type { ReactNode } from "react";
import ThemeScript from "../ThemeScript";
import "../dashboard/dashboard.css";

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ThemeScript />
      {children}
    </>
  );
}
