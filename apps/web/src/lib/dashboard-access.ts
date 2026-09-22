import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DashboardRole = "admin" | "technician";

export async function requireDashboardAccess(requiredRole?: DashboardRole) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;

  if (authError || !user) redirect("/sign-in");

  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("workspace_memberships")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  const membership = membershipResult.data?.[0];
  if (
    profileResult.error
    || membershipResult.error
    || !membership
    || (membership.role !== "admin" && membership.role !== "technician")
  ) {
    redirect("/dashboard");
  }

  if (requiredRole && membership.role !== requiredRole) redirect("/dashboard");

  const workspaceResult = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", membership.workspace_id)
    .maybeSingle();

  if (workspaceResult.error || !workspaceResult.data) redirect("/dashboard");

  const email = user.email ?? "Signed-in account";
  return {
    email,
    displayName: profileResult.data?.display_name.trim() || email,
    role: membership.role as DashboardRole,
    workspace: workspaceResult.data,
  };
}
