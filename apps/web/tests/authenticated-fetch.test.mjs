import assert from "node:assert/strict";
import test from "node:test";

import { browserFetch, fetchWithSingleAuthRetry } from "../src/lib/authenticated-fetch.ts";

test("dashboard requests invoke fetch with the Window receiver", async () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requestedUrls = [];
  const fakeWindow = {
    fetch: async function (input) {
      assert.equal(this, fakeWindow);
      requestedUrls.push(String(input));
      return new Response(null, { status: 200 });
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });

  try {
    const dependencies = {
      getAccessToken: async () => "valid-token",
      refreshAccessToken: async () => null,
      send: browserFetch,
    };
    const dashboardUrls = [
      "http://localhost:8000/workspaces/demo/equipment",
      "http://localhost:8000/workspaces/demo/documents",
      "http://localhost:8000/workspaces/demo/fault-reports",
    ];

    const responses = await Promise.all(
      dashboardUrls.map((url) => fetchWithSingleAuthRetry(url, undefined, dependencies)),
    );

    assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
    assert.deepEqual(requestedUrls, dashboardUrls);
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      delete globalThis.window;
    }
  }
});

test("a 401 refreshes the token and retries exactly once", async () => {
  const authorizations = [];
  let requestCount = 0;
  let refreshCount = 0;

  const response = await fetchWithSingleAuthRetry("http://localhost/protected", undefined, {
    getAccessToken: async () => "first-token",
    refreshAccessToken: async () => {
      refreshCount += 1;
      return "refreshed-token";
    },
    send: async (_input, init) => {
      requestCount += 1;
      authorizations.push(new Headers(init?.headers).get("Authorization"));
      return new Response(null, { status: requestCount === 1 ? 401 : 200 });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(requestCount, 2);
  assert.equal(refreshCount, 1);
  assert.deepEqual(authorizations, ["Bearer first-token", "Bearer refreshed-token"]);
});

test("a 403 remains final and is never refreshed", async () => {
  let requestCount = 0;
  let refreshCount = 0;

  const response = await fetchWithSingleAuthRetry("http://localhost/protected", undefined, {
    getAccessToken: async () => "valid-token",
    refreshAccessToken: async () => {
      refreshCount += 1;
      return "unexpected-token";
    },
    send: async () => {
      requestCount += 1;
      return new Response(null, { status: 403 });
    },
  });

  assert.equal(response.status, 403);
  assert.equal(requestCount, 1);
  assert.equal(refreshCount, 0);
});

test("a failed refresh returns the original 401 without another request", async () => {
  let requestCount = 0;
  let refreshCount = 0;

  const response = await fetchWithSingleAuthRetry("http://localhost/protected", undefined, {
    getAccessToken: async () => "stale-token",
    refreshAccessToken: async () => {
      refreshCount += 1;
      return null;
    },
    send: async () => {
      requestCount += 1;
      return new Response(null, { status: 401 });
    },
  });

  assert.equal(response.status, 401);
  assert.equal(requestCount, 1);
  assert.equal(refreshCount, 1);
});
