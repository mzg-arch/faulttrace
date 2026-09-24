import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

export default async function SetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    const errorStatus = error?.status;
    const unavailable = errorStatus === 0 || (errorStatus !== undefined && errorStatus >= 500);
    redirect(`/sign-in?notice=${unavailable ? "invite-unavailable" : "invalid-invite"}`);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0d0f10]">
      <div aria-hidden="true" className="faulttrace-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
        <header className="border-b border-white/10 py-7"><BrandMark /></header>
        <section className="mx-auto max-w-lg py-16 sm:py-24">
          <div className="rounded-lg border border-white/10 bg-[#151719]/95 p-7 shadow-sm sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Invitation accepted</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Set your FaultTrace password</h1>
            <p className="mt-3 text-sm leading-7 text-zinc-400">Choose a password for {data.user.email}. You will continue to the workspace assigned by your administrator.</p>
            <SetPasswordForm />
          </div>
        </section>
      </div>
    </main>
  );
}
