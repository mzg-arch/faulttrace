"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { API_ORIGIN, apiErrorMessage } from "@/lib/faulttrace-api";

type FieldErrors = {
  workspaceName?: string;
  administratorName?: string;
  email?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CreateWorkspaceForm() {
  const [workspaceName, setWorkspaceName] = useState("");
  const [administratorName, setAdministratorName] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedWorkspaceName = workspaceName.trim().replace(/\s+/g, " ");
    const normalizedAdministratorName = administratorName.trim().replace(/\s+/g, " ");
    const normalizedEmail = email.trim().toLowerCase();
    const errors: FieldErrors = {};
    if (normalizedWorkspaceName.length < 2) errors.workspaceName = "Enter your company or workspace name.";
    if (normalizedAdministratorName.length < 2) errors.administratorName = "Enter the Administrator's full name.";
    if (!emailPattern.test(normalizedEmail)) errors.email = "Enter a valid work email.";

    setFieldErrors(errors);
    setRequestError(null);
    setSuccess(null);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_ORIGIN}/onboarding/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_name: normalizedWorkspaceName,
          administrator_name: normalizedAdministratorName,
          email: normalizedEmail,
        }),
      });
      if (!response.ok) {
        setRequestError(await apiErrorMessage(response, "Company workspace setup is unavailable right now."));
        return;
      }
      const result = (await response.json()) as { message: string };
      setSuccess(result.message);
    } catch {
      setRequestError("Company workspace setup is unavailable right now. Try again later.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="mt-8 rounded-md border border-emerald-300/25 bg-emerald-300/5 p-5" role="status">
        <p className="font-semibold text-emerald-100">Check your work email</p>
        <p className="mt-2 text-sm leading-6 text-zinc-300">{success}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Open the invitation to set your password. You can then sign in as the first Administrator.
        </p>
        <Link href="/sign-in" className="mt-5 inline-flex cursor-pointer rounded-md border border-white/15 px-4 py-2.5 text-sm font-semibold text-zinc-100 transition hover:border-teal-300/40 hover:text-teal-100">
          Return to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} className="mt-8 space-y-5">
      <div>
        <label htmlFor="workspace-name" className="block text-sm font-medium text-zinc-200">Company or workspace name</label>
        <input
          id="workspace-name"
          name="workspace-name"
          value={workspaceName}
          onChange={(event) => {
            setWorkspaceName(event.target.value);
            setFieldErrors((current) => ({ ...current, workspaceName: undefined }));
          }}
          maxLength={120}
          autoComplete="organization"
          disabled={isSubmitting}
          aria-invalid={Boolean(fieldErrors.workspaceName)}
          className="mt-2 w-full rounded-md border border-white/15 bg-[#111315] px-4 py-3.5 text-white outline-none placeholder:text-zinc-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20 disabled:opacity-60"
          placeholder="Northstar Manufacturing"
        />
        {fieldErrors.workspaceName && <p className="mt-2 text-sm text-amber-200">{fieldErrors.workspaceName}</p>}
      </div>

      <div>
        <label htmlFor="administrator-name" className="block text-sm font-medium text-zinc-200">Administrator full name</label>
        <input
          id="administrator-name"
          name="administrator-name"
          value={administratorName}
          onChange={(event) => {
            setAdministratorName(event.target.value);
            setFieldErrors((current) => ({ ...current, administratorName: undefined }));
          }}
          maxLength={120}
          autoComplete="name"
          disabled={isSubmitting}
          aria-invalid={Boolean(fieldErrors.administratorName)}
          className="mt-2 w-full rounded-md border border-white/15 bg-[#111315] px-4 py-3.5 text-white outline-none placeholder:text-zinc-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20 disabled:opacity-60"
          placeholder="Jordan Lee"
        />
        {fieldErrors.administratorName && <p className="mt-2 text-sm text-amber-200">{fieldErrors.administratorName}</p>}
      </div>

      <div>
        <label htmlFor="onboarding-email" className="block text-sm font-medium text-zinc-200">Work email</label>
        <input
          id="onboarding-email"
          name="onboarding-email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setFieldErrors((current) => ({ ...current, email: undefined }));
          }}
          maxLength={320}
          autoComplete="email"
          disabled={isSubmitting}
          aria-invalid={Boolean(fieldErrors.email)}
          className="mt-2 w-full rounded-md border border-white/15 bg-[#111315] px-4 py-3.5 text-white outline-none placeholder:text-zinc-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20 disabled:opacity-60"
          placeholder="jordan@company.com"
        />
        {fieldErrors.email && <p className="mt-2 text-sm text-amber-200">{fieldErrors.email}</p>}
      </div>

      {requestError && <p role="alert" className="rounded-md border border-red-300/25 bg-red-300/5 px-4 py-3 text-sm leading-6 text-red-100">{requestError}</p>}

      <button type="submit" disabled={isSubmitting} className="flex w-full cursor-pointer items-center justify-center rounded-md bg-teal-300 px-4 py-3.5 text-sm font-bold text-[#0d0f10] transition hover:bg-teal-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-wait disabled:opacity-60">
        {isSubmitting ? "Creating secure workspace..." : "Create company workspace"}
      </button>
    </form>
  );
}
