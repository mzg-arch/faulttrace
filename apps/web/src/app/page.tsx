import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";

const steps = [
  {
    number: "01",
    title: "Identify the asset",
    description: "Begin with equipment context and the fault code, symptom, or photo at hand.",
  },
  {
    number: "02",
    title: "Follow the evidence",
    description: "Work through safety guidance and cited steps from approved sources.",
  },
  {
    number: "03",
    title: "Carry the learning forward",
    description: "Capture a resolved case for the next technician facing a similar fault.",
  },
];

const preview = [
  ["01", "Equipment context", "Select the asset and describe the fault."],
  ["02", "Approved evidence", "Review relevant manuals and bulletins."],
  ["03", "Guided resolution", "Record the outcome for the team."],
];

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07111c]">
      <div aria-hidden="true" className="faulttrace-grid pointer-events-none absolute inset-0 opacity-50" />
      <div aria-hidden="true" className="faulttrace-glow pointer-events-none absolute -right-72 -top-56 size-[720px]" />

      <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
        <header className="flex items-center justify-between border-b border-white/10 py-7">
          <BrandMark />
          <Link
            href="/sign-in"
            className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/70 hover:bg-cyan-300/15"
          >
            Sign in <span aria-hidden="true" className="ml-1">↗</span>
          </Link>
        </header>

        <section className="grid gap-14 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16 lg:py-28">
          <div>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <span className="size-1.5 rounded-full bg-cyan-300" />
              Evidence-grounded maintenance
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl xl:text-7xl">
              Trace the fault.
              <span className="block text-cyan-300">Trust the source.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
              FaultTrace brings approved equipment knowledge into a guided troubleshooting workflow, so teams can see the evidence behind every step.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-5">
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-3 rounded-xl bg-cyan-300 px-6 py-3.5 text-sm font-bold text-[#07111c] transition hover:bg-cyan-200"
              >
                Open workspace <span aria-hidden="true">→</span>
              </Link>
              <span className="text-sm text-slate-400">Access is for invited teams.</span>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#101e2d]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)] sm:p-7">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Workflow preview</p>
                <h2 className="mt-2 text-xl font-semibold text-white">From signal to solution</h2>
              </div>
              <span className="shrink-0 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-200">
                Safety first
              </span>
            </div>
            <ol className="mt-6 space-y-4">
              {preview.map(([number, title, detail]) => (
                <li key={number} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-xs font-bold text-cyan-300">
                    {number}
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-100">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="workflow-title" className="border-t border-white/10 pb-20 pt-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">The FaultTrace path</p>
              <h2 id="workflow-title" className="mt-3 text-3xl font-semibold tracking-tight text-white">Built for the work on site</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-slate-400">A clear path from the first symptom to a documented fix.</p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {steps.map((step) => (
              <article key={step.number} className="rounded-2xl border border-white/10 bg-[#101e2d]/75 p-6">
                <span className="text-sm font-bold text-cyan-300">{step.number}</span>
                <h3 className="mt-6 text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-400">{step.description}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
