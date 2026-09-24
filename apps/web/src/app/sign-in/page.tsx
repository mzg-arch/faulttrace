import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0d0f10]">
      <div aria-hidden="true" className="faulttrace-grid pointer-events-none absolute inset-0 opacity-40" />

      <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
        <header className="flex items-center justify-between border-b border-white/10 py-7">
          <BrandMark />
          <Link href="/" className="cursor-pointer text-sm font-medium text-zinc-400 transition hover:text-teal-200">
            <span aria-hidden="true" className="mr-2">←</span> Back to overview
          </Link>
        </header>

        <div className="grid min-h-[calc(100vh-100px)] items-center gap-12 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:py-20">
          <section className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">A clearer path through every fault</p>
            <h1 className="mt-6 text-5xl font-semibold leading-[1.1] tracking-tight text-white sm:text-6xl">
              Your next fix starts with trusted knowledge.
            </h1>
            <p className="mt-7 text-lg leading-8 text-zinc-300">
              One workspace for approved manuals, equipment context, and the lessons your team chooses to save.
            </p>

            <div className="mt-12 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-teal-300">01 / Evidence</span>
                <p className="mt-3 text-sm leading-6 text-zinc-300">Guidance tied to approved sources.</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-amber-200">02 / Safety</span>
                <p className="mt-3 text-sm leading-6 text-zinc-300">Safety context before action.</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="sign-in-title" className="w-full rounded-lg border border-white/10 bg-[#151719] p-7 shadow-sm sm:p-10">
            <div className="mb-8 flex items-center justify-between gap-4">
              <span className="rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.13em] text-teal-200">
                Workspace access
              </span>
              <span className="text-xs text-zinc-500">Secure access</span>
            </div>
            <h2 id="sign-in-title" className="text-3xl font-semibold tracking-tight text-white">Welcome back</h2>
            <p className="mt-3 text-sm leading-7 text-zinc-400">
              Sign in with your company account to continue to FaultTrace.
            </p>

            {notice === "invalid-invite" && (
              <p role="alert" className="mt-5 rounded-md border border-red-300/25 bg-red-300/5 px-4 py-3 text-sm leading-6 text-red-100">
                This invitation link is invalid or expired. Ask your workspace administrator for help.
              </p>
            )}
            {notice === "invite-unavailable" && (
              <p role="alert" className="mt-5 rounded-md border border-red-300/25 bg-red-300/5 px-4 py-3 text-sm leading-6 text-red-100">
                FaultTrace could not complete the invitation right now. Open the invitation link again in a moment.
              </p>
            )}

            <SignInForm />
            <div className="mt-6 border-t border-white/10 pt-5 text-center">
              <Link href="/create-workspace" className="cursor-pointer text-sm font-medium text-zinc-400 transition hover:text-teal-200">
                New company? Create your workspace
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
