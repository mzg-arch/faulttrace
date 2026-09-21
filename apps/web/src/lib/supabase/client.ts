import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicConfig } from "./config";

export function createSupabaseBrowserClient() {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createBrowserClient(url, publishableKey, {
    // Auth callbacks are handled explicitly in /auth/confirm so both the
    // default implicit invite redirect and PKCE authorization codes work.
    auth: { detectSessionInUrl: false },
  });
}
