"use client";

import type { EmailOtpType } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import { BrandMark } from "@/components/brand-mark";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const INVALID_INVITE_PATH = "/sign-in?notice=invalid-invite";
const INVITE_UNAVAILABLE_PATH = "/sign-in?notice=invite-unavailable";

function firstParameter(
  search: URLSearchParams,
  fragment: URLSearchParams,
  name: string,
) {
  return search.get(name) ?? fragment.get(name);
}

function failurePath(error: unknown) {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number(error.status);
    if (status === 0 || status >= 500) return INVITE_UNAVAILABLE_PATH;
  }
  return INVALID_INVITE_PATH;
}

export default function ConfirmInvitationPage() {
  const confirmationStarted = useRef(false);

  useEffect(() => {
    // React Strict Mode replays effects during development. Keep the exchange
    // single-run because the first pass removes one-time credentials from the
    // address bar before awaiting Supabase.
    if (confirmationStarted.current) return;
    confirmationStarted.current = true;

    async function completeInvitation() {
      const url = new URL(window.location.href);
      const search = url.searchParams;
      const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
      const callbackError = firstParameter(search, fragment, "error");
      const callbackErrorCode = firstParameter(search, fragment, "error_code");

      if (callbackError || callbackErrorCode) {
        window.location.replace(INVALID_INVITE_PATH);
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      const code = search.get("code");
      const flowId = search.get("sb_flow_id");
      const tokenHash = search.get("token_hash");
      const type = search.get("type") as EmailOtpType | null;

      // The values have been copied into memory; remove credentials and
      // one-time codes from browser history before making network requests.
      window.history.replaceState(window.history.state, "", "/auth/confirm");

      let exchangeError: Error | null = null;

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        exchangeError = error;
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(
          code,
          flowId ? { flowId } : undefined,
        );
        exchangeError = error;
      } else if (tokenHash && type === "invite") {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        exchangeError = error;
      } else {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) {
          exchangeError = error ?? new Error("No invitation session was provided.");
        }
      }

      if (exchangeError) {
        window.location.replace(failurePath(exchangeError));
        return;
      }

      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user) {
        window.location.replace(failurePath(userError));
        return;
      }

      // A full navigation removes auth values from the address bar and lets
      // the protected Server Component read the newly persisted cookie session.
      window.location.replace("/set-password");
    }

    void completeInvitation().catch(() => {
      window.location.replace(INVITE_UNAVAILABLE_PATH);
    });
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0d0f10]">
      <div aria-hidden="true" className="faulttrace-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
        <header className="border-b border-white/10 py-7"><BrandMark /></header>
        <section className="mx-auto max-w-lg py-16 sm:py-24">
          <div className="rounded-lg border border-white/10 bg-[#151719]/95 p-7 text-center shadow-sm sm:p-10">
            <div className="mx-auto size-8 animate-spin rounded-full border-2 border-teal-300/25 border-t-teal-300" aria-hidden="true" />
            <h1 className="mt-6 text-2xl font-semibold text-white">Accepting your invitation</h1>
            <p role="status" className="mt-3 text-sm leading-7 text-zinc-400">
              Verifying your FaultTrace access and preparing password setup.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
