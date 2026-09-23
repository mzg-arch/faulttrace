type AuthenticatedFetchDependencies = {
  getAccessToken: () => Promise<string>;
  refreshAccessToken: () => Promise<string | null>;
  send: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function requestWithToken(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

export function browserFetch(input: RequestInfo | URL, init?: RequestInit) {
  return window.fetch(input, init);
}

export async function fetchWithSingleAuthRetry(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  dependencies: AuthenticatedFetchDependencies,
) {
  const token = await dependencies.getAccessToken();
  const firstResponse = await dependencies.send(input, requestWithToken(init, token));

  // A stale token is the only authorization failure that is safe to retry.
  // A 403 remains final because refreshing must never bypass workspace or role checks.
  if (firstResponse.status !== 401) return firstResponse;

  const refreshedToken = await dependencies.refreshAccessToken();
  if (!refreshedToken) return firstResponse;
  return dependencies.send(input, requestWithToken(init, refreshedToken));
}
