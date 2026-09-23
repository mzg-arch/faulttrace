"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

import { BrandMark } from "@/components/brand-mark";
import { initializeAuthSession } from "@/lib/faulttrace-api";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthState = "loading" | "ready" | "error";

function SessionStatus({ error }: { error?: boolean }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07111c] px-6">
      <div aria-hidden="true" className="faulttrace-grid pointer-events-none absolute inset-0 opacity-35" />
      <div aria-hidden="true" className="faulttrace-glow pointer-events-none absolute -right-80 -top-72 size-[720px]" />
      <section className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#101e2d]/95 p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
        <div className="flex justify-center"><BrandMark /></div>
        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
          Secure workspace
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-white">
          {error ? "Session could not be verified" : "Verifying your session"}
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          {error
            ? "Sign in again to continue to your authorized workspace."
            : "Waiting for secure sign-in to finish before loading workspace data."}
        </p>
        {error && (
          <a href="/sign-in" className="mt-6 inline-flex rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-[#07111c] hover:bg-cyan-200">
            Return to sign in
          </a>
        )}
      </section>
    </main>
  );
}

export function AuthSessionGate({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>("loading");

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();
    const { data: listener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!active) return;
      if (session?.access_token) setAuthState("ready");
    });

    void initializeAuthSession().then((result) => {
      const { data, error } = result;
      if (!active) return;
      if (error || !data.session?.access_token) {
        setAuthState("error");
        return;
      }
      setAuthState("ready");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (authState === "loading") return <SessionStatus />;
  if (authState === "error") return <SessionStatus error />;
  return children;
}
