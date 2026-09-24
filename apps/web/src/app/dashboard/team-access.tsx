"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { API_ORIGIN, apiErrorMessage, authenticatedFetch } from "@/lib/faulttrace-api";

type Role = "admin" | "technician";

type Member = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: Role;
  status: "active" | "invited";
};

type InviteResponse = {
  message: string;
  member: Member;
};

export function TeamAccess({ workspaceId }: { workspaceId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("technician");
  const [isInviting, setIsInviting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await authenticatedFetch(`${API_ORIGIN}/workspaces/${workspaceId}/members`);
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Team access could not be loaded."));
      }
      setMembers((await response.json()) as Member[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Team access could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMembers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMembers]);

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isInviting) return;

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = displayName.trim().replace(/\s+/g, " ");
    setFormError(null);
    setSuccess(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFormError("Enter a valid work email.");
      return;
    }
    if (!normalizedName) {
      setFormError("Enter the member's display name.");
      return;
    }

    setIsInviting(true);
    try {
      const response = await authenticatedFetch(`${API_ORIGIN}/workspaces/${workspaceId}/invitations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          display_name: normalizedName,
          role,
        }),
      });

      if (!response.ok) {
        setFormError(await apiErrorMessage(response, "The invitation could not be sent."));
        return;
      }

      const result = (await response.json()) as InviteResponse;
      setMembers((current) => [...current, result.member]);
      setEmail("");
      setDisplayName("");
      setRole("technician");
      setSuccess(result.message);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The invitation service is unavailable.");
    } finally {
      setIsInviting(false);
    }
  }

  return (
    <section id="team" className="scroll-mt-6 rounded-lg border border-white/10 bg-[#151719] p-5 sm:p-6" aria-labelledby="team-access-title">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Admin controls</p>
          <h2 id="team-access-title" className="mt-2 text-xl font-semibold text-white">Members and invitations</h2>
        </div>
        <p className="max-w-lg text-sm leading-6 text-zinc-400">
          Administrators manage people, equipment, and approved documents. Technicians create and work fault reports.
        </p>
      </div>

      <div className="grid gap-8 pt-7 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-white">Current members</h3>
            {!isLoading && !loadError && <span className="text-xs text-zinc-500">{members.length} total</span>}
          </div>

          {isLoading && <p role="status" className="rounded-md border border-white/10 p-4 text-sm text-zinc-400">Loading members...</p>}
          {loadError && (
            <div role="alert" className="rounded-md border border-red-300/25 bg-red-300/5 p-4 text-sm text-red-100">
              <p>{loadError}</p>
              <button type="button" onClick={() => void loadMembers()} className="mt-3 font-semibold text-teal-200 hover:text-teal-100">Try again</button>
            </div>
          )}
          {!isLoading && !loadError && members.length === 0 && (
            <p className="rounded-md border border-white/10 p-4 text-sm text-zinc-400">No members were found.</p>
          )}
          {!isLoading && !loadError && members.length > 0 && (
            <ul className="space-y-3">
              {members.map((member) => (
                <li key={member.user_id} className="flex flex-col gap-3 rounded-md border border-white/10 bg-[#111315] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-100">{member.display_name}</p>
                    <p className="mt-1 truncate text-xs text-zinc-500">{member.email ?? "Email unavailable"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs font-semibold capitalize">
                    <span className="rounded-full border border-white/10 px-3 py-1 text-zinc-300">{member.role}</span>
                    <span className={member.status === "active" ? "rounded-full border border-emerald-300/20 bg-emerald-300/5 px-3 py-1 text-emerald-200" : "rounded-full border border-amber-300/20 bg-amber-300/5 px-3 py-1 text-amber-100"}>
                      {member.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={handleInvite} noValidate aria-busy={isInviting} className="rounded-lg border border-white/10 bg-[#111315] p-5 sm:p-6">
          <h3 className="font-semibold text-white">Invite member</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-400">Invited people sign in normally after setting a password, and their workspace access is assigned automatically.</p>
          <div className="mt-5 space-y-4">
            <label className="block text-sm text-zinc-300">
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={isInviting} maxLength={120} autoComplete="name" className="mt-2 w-full rounded-md border border-white/15 bg-[#0d0f10] px-3.5 py-3 text-white outline-none focus:border-teal-300 disabled:opacity-60" />
            </label>
            <label className="block text-sm text-zinc-300">
              Work email
              <input value={email} onChange={(event) => setEmail(event.target.value)} disabled={isInviting} maxLength={320} type="email" inputMode="email" autoComplete="email" className="mt-2 w-full rounded-md border border-white/15 bg-[#0d0f10] px-3.5 py-3 text-white outline-none focus:border-teal-300 disabled:opacity-60" />
            </label>
            <label className="block text-sm text-zinc-300">
              Workspace role
              <select value={role} onChange={(event) => setRole(event.target.value as Role)} disabled={isInviting} className="mt-2 w-full rounded-md border border-white/15 bg-[#0d0f10] px-3.5 py-3 text-white outline-none focus:border-teal-300 disabled:opacity-60">
                <option value="technician">Technician</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>

          {formError && <p role="alert" className="mt-4 rounded-md border border-red-300/25 bg-red-300/5 px-4 py-3 text-sm text-red-100">{formError}</p>}
          {success && <p role="status" className="mt-4 rounded-md border border-emerald-300/25 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-100">{success}</p>}

          <button type="submit" disabled={isInviting} className="mt-5 w-full rounded-md bg-teal-300 px-4 py-3 text-sm font-bold text-[#0d0f10] transition hover:bg-teal-200 disabled:cursor-wait disabled:opacity-60">
            {isInviting ? "Sending invitation..." : "Send invitation"}
          </button>
        </form>
      </div>
    </section>
  );
}
