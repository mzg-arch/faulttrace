"use client";

import { useState, type FormEvent } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type FieldErrors = {
  email?: string;
  password?: string;
};

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};

  if (!email) {
    errors.email = "Enter your work email.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!password) {
    errors.password = "Enter your password.";
  }

  return errors;
}

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedEmail = email.trim();
    const errors = validate(normalizedEmail, password);
    setFieldErrors(errors);
    setAuthError(null);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        setAuthError(
          error.status === 429
            ? "Too many sign-in attempts. Please wait and try again."
            : error.code === "email_not_confirmed"
              ? "Confirm your email before signing in, or contact your maintenance lead."
              : "Email or password was not accepted. Check your details or contact your maintenance lead.",
        );
        return;
      }

      if (!data.session) {
        setAuthError("Your account is not ready to sign in. Contact your maintenance lead.");
        return;
      }

      // A full navigation ensures the dashboard reads the new cookie session.
      window.location.replace("/dashboard");
    } catch {
      setAuthError("Sign-in is unavailable right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-200">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setFieldErrors((current) => ({ ...current, email: undefined }));
            setAuthError(null);
          }}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          disabled={isSubmitting}
          placeholder="you@company.com"
          className="mt-2 w-full rounded-md border border-white/15 bg-[#111315] px-4 py-3.5 text-white outline-none placeholder:text-zinc-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20 disabled:opacity-60"
        />
        {fieldErrors.email && (
          <p id="email-error" className="mt-2 text-sm text-amber-200">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-zinc-200">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setFieldErrors((current) => ({ ...current, password: undefined }));
            setAuthError(null);
          }}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? "password-error" : undefined}
          disabled={isSubmitting}
          placeholder="Enter your password"
          className="mt-2 w-full rounded-md border border-white/15 bg-[#111315] px-4 py-3.5 text-white outline-none placeholder:text-zinc-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20 disabled:opacity-60"
        />
        {fieldErrors.password && (
          <p id="password-error" className="mt-2 text-sm text-amber-200">
            {fieldErrors.password}
          </p>
        )}
      </div>

      {authError && (
        <p role="alert" className="rounded-md border border-red-300/30 bg-red-300/10 px-4 py-3 text-sm leading-6 text-red-100">
          {authError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-teal-300 px-4 py-3.5 text-sm font-bold text-[#0d0f10] transition hover:bg-teal-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-wait disabled:opacity-60"
      >
        {isSubmitting ? "Signing in..." : "Sign in to FaultTrace"}
      </button>
      <p className="text-center text-xs leading-5 text-zinc-500">
        Access is limited to accounts created by your maintenance team.
      </p>
    </form>
  );
}
