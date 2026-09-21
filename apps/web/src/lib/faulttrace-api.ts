import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export const API_ORIGIN = "http://localhost:8000";

export async function getAccessToken() {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Your session has expired. Sign in again.");
  }
  return data.session.access_token;
}

export async function apiErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || fallback;
  } catch {
    return fallback;
  }
}
