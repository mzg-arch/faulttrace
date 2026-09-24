import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "../sign-out-button";

export function FaultReportShell({
  email,
  workspaceName,
  sectionLabel = "Fault report",
  children,
}: {
  email: string;
  workspaceName: string;
  sectionLabel?: string;
  children: ReactNode;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07111c]">
      <div aria-hidden="true" className="faulttrace-grid pointer-events-none absolute inset-0 opacity-35" />
      <div aria-hidden="true" className="faulttrace-glow pointer-events-none absolute -right-80 -top-72 size-[720px]" />
      <div className="relative mx-auto max-w-6xl px-6 sm:px-10">
        <header className="flex flex-wrap items-center justify-between gap-5 border-b border-white/10 py-7">
          <BrandMark />
          <div className="flex items-center gap-5">
            <span className="hidden max-w-64 truncate text-sm text-slate-400 sm:block">{email}</span>
            <SignOutButton />
          </div>
        </header>
        <nav className="flex flex-wrap items-center gap-3 py-6 text-sm" aria-label="Breadcrumb">
          <Link href="/dashboard" className="font-semibold text-cyan-200 hover:text-cyan-100">
            Dashboard
          </Link>
          <span aria-hidden="true" className="text-slate-600">/</span>
          <span className="text-slate-400">{workspaceName}</span>
          <span aria-hidden="true" className="text-slate-600">/</span>
          <span className="text-slate-300">{sectionLabel}</span>
        </nav>
        {children}
        <p className="my-10 border-t border-white/10 pt-6 text-sm leading-7 text-slate-400">
          FaultTrace supports qualified technicians. Follow current site procedures, authorization requirements, LOTO requirements, and professional judgment.
        </p>
      </div>
    </main>
  );
}
