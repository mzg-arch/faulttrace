"use client";

import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setError("Could not sign out. Please try again.");
        return;
      }
      window.location.replace("/sign-in");
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="w-full cursor-pointer rounded-md border border-white/10 px-3 py-2 text-left text-sm font-medium text-zinc-400 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-wait disabled:opacity-60"
      >
        {isSigningOut ? "Signing out..." : "Sign out"}
      </button>
      {error && <p role="alert" className="text-xs text-red-200">{error}</p>}
    </div>
  );
}
