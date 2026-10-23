import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../src/api.js";

test("hosted sign-in persists only its session, sends it as a bearer, and forgets it on revocation", async () => {
  const values = new Map();
  const storage = {
    getItem: (k) => values.get(k),
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  const calls = [];
  const token = "a".repeat(64);
  let status = 200;
  const options = {
    base: "https://example.supabase.co/functions/v1/train-together",
    storage,
    fetcher: async (url, init) => {
      calls.push({ url, ...init });
      return new Response(JSON.stringify({ token, error: "Sign in" }), {
        status,
      });
    },
  };
  const api = createApiClient(options);
  await api("/auth/verify", { email: "mike@example.com", code: "123456" });
  const reopened = createApiClient(options);
  await reopened("/state");
  assert.equal(calls[1].headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[1].credentials, "omit");
  status = 401;
  await assert.rejects(reopened("/state"), /Sign in/);
  assert.equal(values.size, 0);
  status = 200;
  await reopened("/state");
  assert.equal(calls.at(-1).headers.Authorization, undefined);
});

test("local API keeps cookie authentication and hosted sign-out clears storage", async () => {
  let options;
  const local = createApiClient({
    fetcher: async (_url, init) => {
      options = init;
      return Response.json({ ok: true });
    },
  });
  await local("/state");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.headers.Authorization, undefined);
  let removed;
  const hosted = createApiClient({
    base: "https://example.com",
    storage: {
      getItem: () => "a".repeat(64),
      removeItem: (key) => {
        removed = key;
      },
    },
    fetcher: async () => Response.json({ ok: true }),
  });
  await hosted("/auth/logout", {});
  assert.equal(removed, "tt-session:https://example.com");
});
