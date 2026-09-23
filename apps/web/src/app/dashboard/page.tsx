import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { getVerifiedDashboardUser, retryProtectedQueriesOnce } from "@/lib/dashboard-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DocumentManagement } from "./document-management";
import { EquipmentManagement } from "./equipment-management";
import { FaultReportsOverview } from "./fault-reports-overview";
import { SignOutButton } from "./sign-out-button";
import { TeamAccess } from "./team-access";
import { TechnicianDocuments } from "./technician-documents";
import { TechnicianEquipment } from "./technician-equipment";

const adminAreas = [
  {
    number: "01",
    title: "Team / Access",
    description: "Manage the people approved to work in this workspace.",
    status: "Available",
  },
  {
    number: "02",
    title: "Equipment",
    description: "Organize the assets and equipment identifiers your team maintains.",
    status: "Available",
  },
  {
    number: "03",
    title: "Documents",
    description: "Curate approved manuals, diagrams, bulletins, and fault-code sheets.",
    status: "Available",
  },
  {
    number: "04",
    title: "Fault reports",
    description: "Review technician intakes, work logs, active cases, and resolutions.",
    status: "Available",
  },
];

const technicianAreas = [
  {
    number: "01",
    title: "Equipment",
    description: "Choose an asset and review its approved information.",
    status: "Available",
  },
  {
    number: "02",
    title: "Documents",
    description: "Search and open approved maintenance sources for your workspace.",
    status: "Available",
  },
  {
    number: "03",
    title: "Fault reports",
    description: "Complete the Safety Gate, record work, and resolve owned fault reports.",
    status: "Available",
  },
  {
    number: "04",
    title: "Recent cases",
    description: "Revisit repairs your team chose to document and share.",
    status: "Coming soon",
  },
];

function DashboardShell({
  email,
  children,
}: {
  email: string;
  children: ReactNode;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07111c]">
      <div aria-hidden="true" className="faulttrace-grid pointer-events-none absolute inset-0 opacity-35" />
      <div aria-hidden="true" className="faulttrace-glow pointer-events-none absolute -right-80 -top-72 size-[720px]" />

      <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
        <header className="flex flex-wrap items-center justify-between gap-5 border-b border-white/10 py-7">
          <BrandMark />
          <div className="flex items-center gap-5">
            <span className="hidden max-w-64 truncate text-sm text-slate-400 sm:block">{email}</span>
            <SignOutButton />
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

function DashboardNotice({
  email,
  title,
  message,
}: {
  email: string;
  title: string;
  message: string;
}) {
  return (
    <DashboardShell email={email}>
      <section className="mx-auto max-w-2xl py-20 sm:py-28">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Workspace access</p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white">{title}</h1>
        <p className="mt-5 text-lg leading-8 text-slate-300">{message}</p>
        <div className="mt-8 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5 text-sm leading-7 text-amber-100">
          No workspace tools or company documents are available to this account until access is verified.
        </div>
      </section>
    </DashboardShell>
  );
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await getVerifiedDashboardUser(supabase);
  const user = authData.user;

  if (authError || !user) {
    redirect("/sign-in");
  }

  const email = user.email ?? "Signed-in account";
  const [profileResult, membershipResult] = await retryProtectedQueriesOnce(
    supabase,
    () => Promise.all([
      supabase.from("profiles").select("id, display_name").eq("id", user.id).maybeSingle(),
      supabase
        .from("workspace_memberships")
        .select("workspace_id, role")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
    ]),
  );

  if (profileResult.error || membershipResult.error) {
    return (
      <DashboardNotice
        email={email}
        title="Workspace access could not be verified"
        message="Please try again in a moment. If the problem continues, contact your maintenance lead."
      />
    );
  }

  const membership = membershipResult.data?.[0];
  if (!profileResult.data || !membership) {
    return (
      <DashboardNotice
        email={email}
        title="Your workspace is still being set up"
        message="Your account is signed in, but its profile or workspace membership is not ready. Ask your maintenance lead to finish linking your account."
      />
    );
  }

  if (membership.role !== "admin" && membership.role !== "technician") {
    return (
      <DashboardNotice
        email={email}
        title="Workspace role needs review"
        message="Your account does not have a supported FaultTrace role. Contact your maintenance lead."
      />
    );
  }

  const [workspaceResult] = await retryProtectedQueriesOnce(
    supabase,
    () => Promise.all([
      supabase
        .from("workspaces")
        .select("id, name")
        .eq("id", membership.workspace_id)
        .maybeSingle(),
    ]),
  );

  if (workspaceResult.error || !workspaceResult.data) {
    return (
      <DashboardNotice
        email={email}
        title="Workspace access could not be verified"
        message="We could not confirm your workspace. Contact your maintenance lead if this continues."
      />
    );
  }

  const isAdmin = membership.role === "admin";
  const areas = isAdmin ? adminAreas : technicianAreas;
  const displayName = profileResult.data.display_name.trim() || email;

  return (
    <DashboardShell email={email}>
      <section className="max-w-3xl pb-12 pt-16 sm:pt-20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
          {workspaceResult.data.name} / {isAdmin ? "Admin" : "Technician"}
        </p>
        <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
          {isAdmin ? "Workspace administration" : "Technician workspace"}
        </h1>
        <p className="mt-5 text-lg leading-8 text-slate-300">
          Welcome, {displayName}. {isAdmin
            ? "Your team, equipment, and approved sources will be managed here."
            : "Your equipment, guided checks, and saved cases will be available here."}
        </p>
      </section>

      <section
        aria-label={isAdmin ? "Administration areas" : "Technician areas"}
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      >
        {areas.map((area) => (
          <article key={area.number} className="rounded-2xl border border-white/10 bg-[#101e2d]/85 p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-cyan-300">{area.number}</span>
              <span className={area.status === "Available" ? "text-xs font-medium uppercase tracking-[0.12em] text-emerald-300" : "text-xs font-medium uppercase tracking-[0.12em] text-slate-500"}>{area.status}</span>
            </div>
            <h2 className="mt-8 text-xl font-semibold text-white">{area.title}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-400">{area.description}</p>
          </article>
        ))}
      </section>

      {isAdmin ? (
        <>
          <EquipmentManagement workspaceId={workspaceResult.data.id} />
          <FaultReportsOverview workspaceId={workspaceResult.data.id} role="admin" />
          <DocumentManagement workspaceId={workspaceResult.data.id} />
          <TeamAccess workspaceId={workspaceResult.data.id} />
        </>
      ) : (
        <>
          <TechnicianEquipment workspaceId={workspaceResult.data.id} />
          <FaultReportsOverview workspaceId={workspaceResult.data.id} role="technician" />
          <TechnicianDocuments workspaceId={workspaceResult.data.id} />
        </>
      )}

      <p className="my-10 max-w-3xl border-t border-white/10 pt-6 text-sm leading-7 text-slate-400">
        FaultTrace supports qualified technicians. Follow your site&apos;s approved procedures, authorization requirements, and professional judgment.
      </p>
    </DashboardShell>
  );
}
