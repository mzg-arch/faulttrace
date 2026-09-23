import type { ReactNode } from "react";

import { AuthSessionGate } from "./auth-session-gate";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AuthSessionGate>{children}</AuthSessionGate>;
}
