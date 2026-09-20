import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";

export default function SignInPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07111c]">
      <div aria-hidden="true" className="faulttrace-grid pointer-events-none absolute inset-0 opacity-40" />
      <div aria-hidden="true" className="faulttrace-glow pointer-events-none absolute -left-80 top-10 size-[760px]" />

      <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
        <header className="flex items-center justify-between border-b border-white/10 py-7">
          <BrandMark />
          <Link href="/" className="text-sm font-medium text-slate-400 transition hover:text-cyan-200">
            <span aria-hidden="true" className="mr-2">←</span> Back to overview
          </Link>
        </header>

        <div className="grid min-h-[calc(100vh-100px)] items-center gap-12 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:py-20">
          <section className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">A clearer path through every fault</p>
            <h1 className="mt-6 text-5xl font-semibold leading-[1.1] tracking-tight text-white sm:text-6xl">
              Your next fix starts with trusted knowledge.
            </h1>
            <p className="mt-7 text-lg leading-8 text-slate-300">
              One workspace for approved manuals, equipment context, and the lessons your team chooses to save.
            </p>

            <div className="mt-12 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">01 / Evidence</span>
                <p className="mt-3 text-sm leading-6 text-slate-300">Guidance tied to approved sources.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-amber-200">02 / Safety</span>
                <p className="mt-3 text-sm leading-6 text-slate-300">Safety context before action.</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="sign-in-title" className="w-full rounded-3xl border border-white/10 bg-[#101e2d]/95 p-7 shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:p-10">
            <div className="mb-8 flex items-center justify-between gap-4">
              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.13em] text-cyan-200">
                Workspace access
              </span>
              <span className="text-xs text-slate-500">Invite only</span>
            </div>
            <h2 id="sign-in-title" className="text-3xl font-semibold tracking-tight text-white">Welcome back</h2>
            <p className="mt-3 text-sm leading-7 text-slate-400">
              Sign in with your company account to continue to FaultTrace.
            </p>

            <div className="mt-8 space-y-5" aria-describedby="sign-in-status">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-200">Work email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  disabled
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#091522] px-4 py-3.5 text-slate-400 placeholder:text-slate-600 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-200">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  disabled
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#091522] px-4 py-3.5 text-slate-400 placeholder:text-slate-600 disabled:cursor-not-allowed"
                />
              </div>
              <button
                type="button"
                disabled
                className="w-full rounded-xl bg-cyan-300/45 px-4 py-3.5 text-sm font-bold text-[#07111c] disabled:cursor-not-allowed"
              >
                Sign in to FaultTrace
              </button>
            </div>

            <p id="sign-in-status" role="status" className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm leading-6 text-amber-100">
              Preview only. Sign-in is not active yet, and this page does not submit credentials.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
