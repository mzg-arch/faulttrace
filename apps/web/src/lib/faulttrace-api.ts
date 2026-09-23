import type { AuthError, Session } from "@supabase/supabase-js";

import { fetchWithSingleAuthRetry } from "@/lib/authenticated-fetch";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export const API_ORIGIN = "http://localhost:8000";

type SessionResult = {
  data: { session: Session | null };
  error: AuthError | null;
};

let authInitialization: Promise<SessionResult> | null = null;
let tokenRefresh: Promise<string | null> | null = null;

export function initializeAuthSession(): Promise<SessionResult> {
  if (!authInitialization) {
    authInitialization = createSupabaseBrowserClient().auth.getSession();
  }
  return authInitialization!;
}

export async function getAccessToken() {
  await initializeAuthSession();
  const { data, error } = await createSupabaseBrowserClient().auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Your session has expired. Sign in again.");
  }
  return data.session.access_token;
}

async function refreshAccessTokenOnce() {
  if (!tokenRefresh) {
    tokenRefresh = createSupabaseBrowserClient().auth.refreshSession().then((result: SessionResult) => {
      const { data, error } = result;
      if (error || !data.session?.access_token) return null;
      return data.session.access_token;
    }).finally(() => {
      tokenRefresh = null;
    });
  }
  return tokenRefresh;
}

export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetchWithSingleAuthRetry(input, init, {
    getAccessToken,
    refreshAccessToken: refreshAccessTokenOnce,
    send: fetch,
  });
}

export async function apiErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || fallback;
  } catch {
    return fallback;
  }
}
