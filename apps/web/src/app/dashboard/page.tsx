import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { PageHeader } from "@/components/page-header";
import { getVerifiedDashboardUser, retryProtectedQueriesOnce } from "@/lib/dashboard-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "./app-shell";
import { OperationalDashboard } from "./operational-dashboard";
import { SignOutButton } from "./sign-out-button";

function DashboardNotice({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <main className="min-h-screen bg-[#0d0f10] px-5 text-zinc-100">
      <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-white/10 py-5">
        <BrandMark href="/dashboard" />
        <div className="w-32"><SignOutButton /></div>
      </header>
      <section className="mx-auto max-w-2xl py-20 sm:py-28">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Workspace access</p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white">{title}</h1>
        <p className="mt-5 text-lg leading-8 text-zinc-300">{message}</p>
        <div className="mt-8 rounded-lg border border-amber-300/20 bg-amber-300/5 p-5 text-sm leading-7 text-amber-100">
          No workspace tools or company documents are available to this account until access is verified.
        </div>
      </section>
    </main>
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
        title="Workspace access could not be verified"
        message="Please try again in a moment. If the problem continues, contact your maintenance lead."
      />
    );
  }

  const membership = membershipResult.data?.[0];
  if (!profileResult.data || !membership) {
    return (
      <DashboardNotice
        title="Your workspace is still being set up"
        message="Your account is signed in, but its profile or workspace membership is not ready. Ask your maintenance lead to finish linking your account."
      />
    );
  }

  if (membership.role !== "admin" && membership.role !== "technician") {
    return (
      <DashboardNotice
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
        title="Workspace access could not be verified"
        message="We could not confirm your workspace. Contact your maintenance lead if this continues."
      />
    );
  }

  const isAdmin = membership.role === "admin";
  const displayName = profileResult.data.display_name.trim() || email;

  return (
    <AppShell role={membership.role} workspaceName={workspaceResult.data.name} displayName={displayName} email={email}>
      <PageHeader
        eyebrow={`${workspaceResult.data.name} · ${isAdmin ? "Administrator" : "Technician"}`}
        title={isAdmin ? "Workspace operations" : "My maintenance work"}
        description={isAdmin
          ? `Welcome, ${displayName}. Review current faults, recent resolutions, and workspace activity.`
          : `Welcome, ${displayName}. Continue current work or start a new equipment fault report.`}
      />
      <OperationalDashboard workspaceId={workspaceResult.data.id} role={membership.role} />
      <p className="mt-8 border-t border-white/10 pt-5 text-xs leading-6 text-zinc-500">
        FaultTrace supports qualified technicians. Follow your site&apos;s approved procedures, authorization requirements, and professional judgment.
      </p>
    </AppShell>
  );
}
