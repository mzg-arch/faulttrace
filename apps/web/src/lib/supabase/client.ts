import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicConfig } from "./config";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (!browserClient) {
    const { url, publishableKey } = getSupabasePublicConfig();
    browserClient = createBrowserClient(url, publishableKey, {
      // Auth callbacks are handled explicitly in /auth/confirm so both the
      // default implicit invite redirect and PKCE authorization codes work.
      auth: { detectSessionInUrl: false },
    });
  }
  return browserClient;
}
