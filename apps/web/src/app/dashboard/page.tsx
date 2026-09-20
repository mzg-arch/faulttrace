import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const areas = [
  {
    number: "01",
    title: "Equipment",
    description: "Choose an asset to begin a fault investigation.",
  },
  {
    number: "02",
    title: "Approved sources",
    description: "Find the manuals, diagrams, and bulletins selected by your team.",
  },
  {
    number: "03",
    title: "Resolved cases",
    description: "Return to repairs the team chose to document and share.",
  },
];

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect("/sign-in");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07111c]">
      <div aria-hidden="true" className="faulttrace-grid pointer-events-none absolute inset-0 opacity-35" />
      <div aria-hidden="true" className="faulttrace-glow pointer-events-none absolute -right-80 -top-72 size-[720px]" />

      <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
        <header className="flex items-center justify-between border-b border-white/10 py-7">
          <BrandMark />
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/5 px-4 py-2 text-xs font-semibold text-emerald-200">
            <span className="size-1.5 rounded-full bg-emerald-300" />
            Signed-in session
          </span>
        </header>

        <section className="max-w-3xl pb-12 pt-16 sm:pt-20">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Workspace dashboard / Preview</p>
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
            Every decision starts with evidence.
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-300">
            Your workspace will bring equipment, approved sources, and prior repairs into one clear view. The tools below are being built.
          </p>
        </section>

        <section aria-label="Upcoming workspace areas" className="grid gap-4 md:grid-cols-3">
          {areas.map((area) => (
            <article key={area.number} className="rounded-2xl border border-white/10 bg-[#101e2d]/85 p-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-cyan-300">{area.number}</span>
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Coming soon</span>
              </div>
              <h2 className="mt-8 text-xl font-semibold text-white">{area.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-400">{area.description}</p>
            </article>
          ))}
        </section>

        <section className="my-10 flex flex-col gap-6 rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.04] p-7 sm:flex-row sm:items-center sm:justify-between sm:p-9">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Next in the workflow</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">From the first symptom to a documented fix</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
              Guided troubleshooting and cited safety steps will appear here after the document and equipment workflows are connected.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-amber-300/25 bg-amber-300/10 px-4 py-2 text-xs font-semibold text-amber-200">
            Safety before action
          </span>
        </section>
      </div>
    </main>
  );
}
