"use client";

import { useState, type FormEvent } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);

    if (password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError("Your password could not be saved. Request a new invitation if the link expired.");
        return;
      }
      window.location.replace("/dashboard");
    } catch {
      setError("Password setup is unavailable right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} className="mt-8 space-y-5">
      <label className="block text-sm font-medium text-slate-200">
        New password
        <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={isSubmitting} className="mt-2 w-full rounded-xl border border-white/15 bg-[#091522] px-4 py-3.5 text-white outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 disabled:opacity-60" />
      </label>
      <label className="block text-sm font-medium text-slate-200">
        Confirm password
        <input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={isSubmitting} className="mt-2 w-full rounded-xl border border-white/15 bg-[#091522] px-4 py-3.5 text-white outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 disabled:opacity-60" />
      </label>
      {error && <p role="alert" className="rounded-xl border border-amber-300/25 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">{error}</p>}
      <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-cyan-300 px-4 py-3.5 text-sm font-bold text-[#07111c] transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60">
        {isSubmitting ? "Saving password..." : "Set password and continue"}
      </button>
    </form>
  );
}
