import Link from "next/link";
import type { ReactNode } from "react";

import type { DashboardRole } from "@/lib/dashboard-access";
import { AppShell } from "../app-shell";

export function FaultReportShell({
  role,
  email,
  displayName,
  workspaceName,
  sectionLabel = "Fault Reports",
  sectionHref = "/dashboard/fault-reports",
  children,
}: {
  role: DashboardRole;
  email: string;
  displayName: string;
  workspaceName: string;
  sectionLabel?: string;
  sectionHref?: string;
  children: ReactNode;
}) {
  return (
    <AppShell role={role} email={email} displayName={displayName} workspaceName={workspaceName}>
      <nav className="mb-5 flex flex-wrap items-center gap-2 text-xs text-zinc-500" aria-label="Breadcrumb">
        <Link href="/dashboard" className="cursor-pointer hover:text-teal-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300">
          Dashboard
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={sectionHref} className="cursor-pointer font-medium text-zinc-300 hover:text-teal-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300">
          {sectionLabel}
        </Link>
      </nav>
      {children}
      <p className="mt-8 border-t border-white/10 pt-5 text-xs leading-6 text-zinc-500">
        FaultTrace supports qualified technicians. Follow current site procedures, authorization requirements, LOTO requirements, and professional judgment.
      </p>
    </AppShell>
  );
}
