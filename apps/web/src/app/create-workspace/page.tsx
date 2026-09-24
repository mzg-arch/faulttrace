import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { CreateWorkspaceForm } from "./create-workspace-form";

export default function CreateWorkspacePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0d0f10]">
      <div aria-hidden="true" className="faulttrace-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
        <header className="flex items-center justify-between border-b border-white/10 py-7">
          <BrandMark />
          <Link href="/sign-in" className="cursor-pointer text-sm font-medium text-zinc-400 transition hover:text-teal-200">
            Back to sign in
          </Link>
        </header>

        <div className="grid gap-12 py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:gap-20 lg:py-20">
          <section className="max-w-lg lg:sticky lg:top-16">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">Company setup</p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">Create a secure workspace for your maintenance team.</h1>
            <p className="mt-6 text-base leading-7 text-zinc-300">
              You will become the first Administrator for this company. You can invite additional administrators and technicians after signing in.
            </p>
            <div className="mt-8 rounded-lg border border-amber-300/20 bg-amber-300/5 p-5">
              <p className="text-sm font-semibold text-amber-100">Access stays controlled</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Technicians cannot register themselves. Every additional person must be invited by a workspace Administrator.
              </p>
            </div>
          </section>

          <section aria-labelledby="create-workspace-title" className="w-full rounded-lg border border-white/10 bg-[#151719] p-7 shadow-sm sm:p-10">
            <span className="inline-flex rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.13em] text-teal-200">First Administrator</span>
            <h2 id="create-workspace-title" className="mt-5 text-3xl font-semibold tracking-tight text-white">Company details</h2>
            <p className="mt-3 text-sm leading-7 text-zinc-400">Use your company identity and a work email you can access.</p>
            <CreateWorkspaceForm />
          </section>
        </div>
      </div>
    </main>
  );
}
