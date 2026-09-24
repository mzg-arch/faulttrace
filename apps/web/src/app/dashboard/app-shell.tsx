"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import type { DashboardRole } from "@/lib/dashboard-access";
import { SignOutButton } from "./sign-out-button";

type NavItem = {
  label: string;
  href: string;
  icon: "grid" | "report" | "history" | "equipment" | "document" | "team";
};

const workItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "grid" },
  { label: "Fault Reports", href: "/dashboard/fault-reports", icon: "report" },
  { label: "Resolved History", href: "/dashboard/resolved-history", icon: "history" },
];

const workspaceItems: NavItem[] = [
  { label: "Equipment", href: "/dashboard/equipment", icon: "equipment" },
  { label: "Documents", href: "/dashboard/documents", icon: "document" },
  { label: "Team", href: "/dashboard/team", icon: "team" },
];

function NavigationIcon({ icon }: { icon: NavItem["icon"] }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    report: <><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></>,
    history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" /><path d="M4 4v4.6h4.6M12 8v5l3 2" /></>,
    equipment: <><path d="M5 5h14v14H5zM9 9h6v6H9z" /><path d="M2 9h3M19 9h3M2 15h3M19 15h3" /></>,
    document: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
    team: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.8M17 14c2.3.7 4 2.8 4 5.3" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-5">{paths[icon]}</svg>;
}

function SidebarLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const active = item.href === "/dashboard"
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 ${active ? "border-teal-300/20 bg-teal-300/10 text-teal-100" : "border-transparent text-zinc-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-100"}`}
    >
      <NavigationIcon icon={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

function SidebarContent({
  role,
  workspaceName,
  displayName,
  email,
  pathname,
  close,
}: {
  role: DashboardRole;
  workspaceName: string;
  displayName: string;
  email: string;
  pathname: string;
  close: () => void;
}) {
  const workspaceNavigation = role === "admin" ? workspaceItems : workspaceItems.filter((item) => item.icon !== "team");
  return (
    <div className="flex h-full flex-col bg-[#111315]">
      <div className="flex h-16 items-center border-b border-white/10 px-5"><BrandMark href="/dashboard" /></div>
      <div className="border-b border-white/10 px-5 py-4">
        <p className="truncate text-sm font-semibold text-zinc-100">{workspaceName}</p>
        <span className="mt-2 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{role === "admin" ? "Administrator" : "Technician"}</span>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Primary navigation">
        <div>
          <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Work</p>
          <div className="mt-2 space-y-1">{workItems.map((item) => <SidebarLink key={item.href} item={item} pathname={pathname} onNavigate={close} />)}</div>
        </div>
        <div>
          <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Workspace</p>
          <div className="mt-2 space-y-1">{workspaceNavigation.map((item) => <SidebarLink key={item.href} item={item} pathname={pathname} onNavigate={close} />)}</div>
        </div>
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="mb-3 min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-200">{displayName}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{email}</p>
        </div>
        <SignOutButton />
      </div>
    </div>
  );
}

export function AppShell({
  role,
  workspaceName,
  displayName,
  email,
  children,
}: {
  role: DashboardRole;
  workspaceName: string;
  displayName: string;
  email: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen bg-[#0d0f10] text-zinc-100">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/10 lg:block">
        <SidebarContent role={role} workspaceName={workspaceName} displayName={displayName} email={email} pathname={pathname} close={() => undefined} />
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/10 bg-[#0d0f10]/95 px-4 backdrop-blur lg:hidden">
        <BrandMark href="/dashboard" />
        <button type="button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)} className="cursor-pointer rounded-md border border-white/10 p-2 text-zinc-300 hover:border-teal-300/30 hover:text-teal-100 focus-visible:outline-2 focus-visible:outline-teal-300">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </header>

      {mobileOpen && <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 cursor-pointer bg-black/70 lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-50 w-[min(18rem,86vw)] border-r border-white/10 transition-transform lg:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 z-10 cursor-pointer rounded-md p-2 text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-300">×</button>
        <SidebarContent role={role} workspaceName={workspaceName} displayName={displayName} email={email} pathname={pathname} close={() => setMobileOpen(false)} />
      </aside>

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-[1520px] px-4 py-6 sm:px-6 sm:py-8 xl:px-10">{children}</div>
      </main>
    </div>
  );
}
