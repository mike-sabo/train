import test from "node:test";
import assert from "node:assert/strict";
import { databaseHeaders } from "../cloud/database-headers.js";

test("modern server keys use apikey without a JWT bearer header", () => {
  const headers = databaseHeaders(
    (name) =>
      ({
        SUPABASE_SECRET_KEYS: JSON.stringify({
          default: "sb_secret_test-only",
        }),
        SUPABASE_SERVICE_ROLE_KEY: "legacy-test-only",
      })[name],
  );
  assert.equal(headers.apikey, "sb_secret_test-only");
  assert.equal(headers.Authorization, undefined);
});

test("legacy projects retain server authentication and missing keys fail closed", () => {
  const headers = databaseHeaders((name) =>
    name === "SUPABASE_SERVICE_ROLE_KEY" ? "legacy-test-only" : undefined,
  );
  assert.equal(headers.Authorization, "Bearer legacy-test-only");
  assert.throws(() => databaseHeaders(() => undefined), /No server-side/);
  assert.throws(
    () =>
      databaseHeaders((name) =>
        name === "SUPABASE_SECRET_KEYS" ? "{}" : "legacy-test-only",
      ),
    /default Supabase/,
  );
});
