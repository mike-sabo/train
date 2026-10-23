import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { createHostedHandler, hash } from "../../cloud/handler.js";
import { today, addDays } from "../../server/schema.js";

const connectionString = process.env.TT_TEST_DATABASE_URL;
if (
  !connectionString ||
  !new URL(connectionString).pathname.startsWith("/tt_test_")
)
  throw new Error(
    "Use an isolated database named tt_test_* via TT_TEST_DATABASE_URL.",
  );
const origin = "https://train.example.com";
const plan = JSON.parse(
  readFileSync(new URL("../../plans/foundation-v3.json", import.meta.url)),
);
const planKey = `${plan.id}@${plan.version}`;
const previousMonday = addDays(
  today(),
  -((new Date(`${today()}T12:00:00Z`).getUTCDay() + 6) % 7) - 7,
);

async function fixture(t) {
  const db = new pg.Pool({ connectionString });
  t.after(() => db.end());
  await db.query(
    "drop schema if exists tt_private cascade; drop function if exists public.tt_rpc(text,jsonb,text,text)",
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.query(
      `do $$ begin if not exists(select from pg_roles where rolname='${role}') then create role ${role} ${role === "service_role" ? "bypassrls" : ""}; end if; end $$`,
    );
  }
  for (const file of readdirSync("supabase/migrations").sort())
    await db.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const rpc = async (action, payload = {}, session = "", ip = "") => {
    const client = await db.connect();
    try {
      await client.query("set role service_role");
      return (
        await client.query("select public.tt_rpc($1,$2,$3,$4) as result", [
          action,
          payload,
          session,
          ip,
        ])
      ).rows[0].result;
    } finally {
      await client.query("reset role");
      client.release();
    }
  };
  const mail = [];
  let onMail;
  const options = {
    rpc,
    ownerEmail: "mike@example.com",
    origin,
    sendEmail: async (email, subject, text) => {
      mail.push({ email, subject, text });
      await onMail?.({ email, subject, text });
    },
  };
  const handler = createHostedHandler(options);
  async function request(
    path,
    body,
    token,
    method = body ? "POST" : "GET",
    from = origin,
  ) {
    const r = await handler(
      new Request(
        `https://example.supabase.co/functions/v1/train-together${path}`,
        {
          method,
          headers: {
            Origin: from,
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        },
      ),
    );
    return {
      status: r.status,
      data: r.status === 204 ? null : await r.json(),
      headers: r.headers,
    };
  }
  const send = async (email) => {
    const result = await request("/auth/send", { email });
    assert.equal(result.status, 200, JSON.stringify(result));
    return mail
      .findLast((m) => m.email === email)
      ?.text.match(/code is (\d{6})/)?.[1];
  };
  const login = async (email) => {
    const code = await send(email);
    const result = await request("/auth/verify", { email, code });
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.data.token;
  };
  const invite = async (token, name = "Jason", email = "jason@example.com") => {
    const result = await request("/invites", { name, email }, token);
    assert.equal(result.status, 200, JSON.stringify(result));
  };
  return {
    db,
    rpc,
    request,
    mail,
    login,
    invite,
    send,
    options,
    onMail: (fn) => {
      onMail = fn;
    },
  };
}

test("hosted authentication, one admin, invitation-only access, CORS, and single-use codes", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.request("/status")).data, {
    emailMode: "resend",
    setup: false,
    today: today(),
  });
  assert.equal(
    (await f.request("/setup", { email: "bad@example.com" })).status,
    404,
  );
  assert.equal((await f.request("/state")).status, 401);
  assert.equal(
    (await f.request("/bootstrap", { email: "bad@example.com" })).status,
    404,
  );
  assert.equal(
    (await f.request("/auth/send", { email: "outside@example.com" })).status,
    200,
  );
  assert.equal(f.mail.length, 0);
  const owner = await f.login("mike@example.com");
  assert.equal(owner.length, 64);
  assert.equal(
    (
      await f.request(
        "/invites",
        { name: "Jason", email: "jason@example.com" },
        owner,
        "POST",
        "https://evil.example",
      )
    ).status,
    403,
  );
  const preflight = await f.request("/state", undefined, undefined, "OPTIONS");
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  await f.invite(owner);
  assert.match(f.mail.at(-1).text, /https:\/\/train.example.com\//);
  const code = await f.send("jason@example.com");
  const member = (
    await f.request("/auth/verify", { email: "jason@example.com", code })
  ).data.token;
  assert.equal(
    (await f.request("/auth/verify", { email: "jason@example.com", code }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.request(
        "/invites",
        { name: "No", email: "no@example.com" },
        member,
      )
    ).status,
    403,
  );
  const state = (await f.request("/state", undefined, member)).data;
  assert.equal(state.me.role, "member");
  assert.ok(state.members.every((m) => !("email" in m)));
  assert.equal(state.plans.length, 4);
  assert.equal((await f.request("/members/1/revoke", {}, owner)).status, 403);
  assert.equal(
    (await f.rpc("bootstrap", { email: "jason@example.com" })).status,
    503,
  );
  await f.request("/auth/logout", {}, member);
  assert.equal((await f.request("/state", undefined, member)).status, 401);
  const saved = (await f.db.query("select token from tt_private.sessions"))
    .rows;
  assert.equal(saved[0].token, await hash(owner));
  assert.ok(saved.every((s) => s.token !== owner));
});

test("database permissions deny anonymous and authenticated direct access", async (t) => {
  const f = await fixture(t);
  const client = await f.db.connect();
  try {
    for (const role of ["anon", "authenticated"]) {
      await client.query(`set role ${role}`);
      await assert.rejects(
        client.query(
          "select public.tt_rpc('bootstrap','{\"email\":\"intruder@example.com\"}')",
        ),
        /permission denied/,
      );
      await assert.rejects(
        client.query("select * from tt_private.members"),
        /permission denied/,
      );
      await client.query("reset role");
    }
    await client.query("set role service_role");
    const r = await client.query("select public.tt_rpc('status') as result");
    assert.equal(r.rows[0].result.status, 200);
    await client.query("reset role");
    const rls = await client.query(
      "select relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='tt_private' and relkind='r'",
    );
    assert.ok(rls.rows.every((r) => r.relrowsecurity));
  } finally {
    await client.query("reset role");
    client.release();
  }
});

test("failed codes commit their attempt counts and expired codes cannot sign in", async (t) => {
  const f = await fixture(t);
  const code = await f.send("mike@example.com");
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await f.request("/auth/verify", {
          email: "mike@example.com",
          code: "000000",
        })
      ).status,
      400,
    );
  assert.equal(
    (await f.request("/auth/verify", { email: "mike@example.com", code }))
      .status,
    400,
  );
  assert.equal(
    (await f.db.query("select attempts from tt_private.challenges")).rows[0]
      .attempts,
    6,
  );
  const newCode = await f.send("mike@example.com");
  await f.db.query("update tt_private.challenges set expires=0");
  assert.equal(
    (
      await f.request("/auth/verify", {
        email: "mike@example.com",
        code: newCode,
      })
    ).status,
    400,
  );
  await f.send("mike@example.com");
  assert.equal(
    (await f.request("/auth/send", { email: "mike@example.com" })).status,
    429,
  );
});

test("revocation invalidates sessions and pending codes, including delayed email delivery", async (t) => {
  const f = await fixture(t);
  const owner = await f.login("mike@example.com");
  await f.invite(owner);
  const member = await f.login("jason@example.com");
  const code = await f.send("jason@example.com");
  await f.request("/members/2/revoke", {}, owner);
  assert.equal((await f.request("/state", undefined, member)).status, 401);
  assert.equal(
    (await f.request("/auth/verify", { email: "jason@example.com", code }))
      .status,
    400,
  );
  await f.invite(owner);
  assert.equal((await f.request("/state", undefined, member)).status, 401);
  f.onMail(async ({ email, subject }) => {
    if (email === "jason@example.com" && subject.includes("code")) {
      await f.request("/members/2/revoke", {}, owner);
      await f.invite(owner);
    }
  });
  const delayed = await f.send("jason@example.com");
  assert.equal(
    (
      await f.request("/auth/verify", {
        email: "jason@example.com",
        code: delayed,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.db.query(
        "select count(*)::int n from tt_private.challenges where email='jason@example.com'",
      )
    ).rows[0].n,
    0,
  );
});

test("email failures do not grant access or install a code; stale invitation delivery cannot reactivate a revoked member", async (t) => {
  const f = await fixture(t);
  const owner = await f.login("mike@example.com");
  f.onMail(() => {
    throw Object.assign(new Error("Email delivery failed."), { status: 502 });
  });
  assert.equal(
    (
      await f.request(
        "/invites",
        { name: "Jason", email: "jason@example.com" },
        owner,
      )
    ).status,
    502,
  );
  assert.equal(
    (await f.db.query("select count(*)::int n from tt_private.members")).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await f.request("/auth/send", { email: "mike@example.com" })).status,
    502,
  );
  assert.equal(
    (await f.db.query("select count(*)::int n from tt_private.challenges"))
      .rows[0].n,
    0,
  );
  f.onMail(undefined);
  await f.invite(owner);
  await f.request("/members/2/revoke", {}, owner);
  f.onMail(async () => {
    await f.request("/members/2/revoke", {}, owner);
  });
  assert.equal(
    (
      await f.request(
        "/invites",
        { name: "Jason", email: "jason@example.com" },
        owner,
      )
    ).status,
    409,
  );
  assert.ok(
    (await f.db.query("select removed_at from tt_private.members where id=2"))
      .rows[0].removed_at,
  );
});

test("workouts persist across devices with privacy, atomic revisions, history, themes, and plan validation", async (t) => {
  const f = await fixture(t);
  const owner = await f.login("mike@example.com");
  await f.invite(owner);
  const member = await f.login("jason@example.com");
  const block = { planKey, start: previousMonday, weeks: 8 };
  const mobile = await f.login("jason@example.com");
  assert.notEqual(member, mobile);
  assert.equal((await f.request("/blocks", block, member)).status, 403);
  const concurrentBlocks = await Promise.all([
    f.request("/blocks", block, owner),
    f.request("/blocks", block, owner),
  ]);
  assert.deepEqual(concurrentBlocks.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await f.request("/plans", plan, owner)).status, 409);
  assert.equal(
    (await f.request("/preferences", { theme: "ocean" }, member, "PUT")).status,
    400,
  );
  assert.equal(
    (
      await f.request(
        "/preferences",
        { theme: "ember-sky", member_id: 1 },
        member,
        "PUT",
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.request("/preferences", { theme: "ember-sky" }, member, "PUT"))
      .status,
    200,
  );
  const day = plan.days.find((d) => d.weekday === 1);
  const entries = Object.fromEntries(
    day.exercises.map((e) => [
      e.id,
      {
        done: true,
        variant: e.id,
        sets: Array.from({ length: e.sets }, () => ({ weight: 20, reps: 12 })),
        setLinking: { enabled: true, independent: Array(e.sets).fill(false) },
      },
    ]),
  );
  const body = { revision: 0, entries, completed: true };
  const concurrentLogs = await Promise.all([
    f.request(`/logs/${previousMonday}`, body, member, "PUT"),
    f.request(`/logs/${previousMonday}`, body, mobile, "PUT"),
  ]);
  assert.deepEqual(
    concurrentLogs.map((r) => r.status).sort(),
    [200, 409],
    JSON.stringify(concurrentLogs),
  );
  assert.equal(
    (
      await f.request(
        `/logs/${previousMonday}`,
        { ...body, revision: 1 },
        owner,
        "PUT",
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.request(`/logs/${previousMonday}`, body, owner, "PUT")).status,
    200,
  );
  const memberState = (
    await f.request(`/state?week=${previousMonday}`, undefined, member)
  ).data;
  assert.equal(memberState.logs.find((l) => l.member_id === 2).revision, 1);
  assert.equal(memberState.logs.find((l) => l.member_id === 1).body, undefined);
  const mobileState = (
    await f.request(`/state?week=${previousMonday}`, undefined, mobile)
  ).data;
  assert.equal(mobileState.me.id, memberState.me.id);
  assert.deepEqual(mobileState.logs, memberState.logs);
  const history = (
    await f.request(
      `/history?before=${addDays(previousMonday, 7)}`,
      undefined,
      member,
    )
  ).data.history;
  assert.equal(history[day.exercises[0].id].sets[0].weight, 20);
  const invalid = structuredClone(body);
  invalid.revision = 1;
  invalid.entries[day.exercises[0].id].sets.pop();
  assert.equal(
    (await f.request(`/logs/${previousMonday}`, invalid, member, "PUT")).status,
    400,
  );
  const links = structuredClone(body);
  links.revision = 1;
  links.entries[day.exercises[0].id].setLinking.independent[0] = true;
  assert.equal(
    (await f.request(`/logs/${previousMonday}`, links, member, "PUT")).status,
    400,
  );
  assert.equal(
    (
      await f.request(
        `/logs/${addDays(previousMonday, 1)}`,
        body,
        member,
        "PUT",
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.request(`/logs/${addDays(today(), 1)}`, body, member, "PUT"))
      .status,
    400,
  );
  assert.equal((await f.request("/auth/logout", {}, mobile)).status, 200);
  assert.equal((await f.request("/state", undefined, mobile)).status, 401);
  assert.equal((await f.request("/state", undefined, member)).status, 200);
  await f.request("/members/2/revoke", {}, owner);
  await f.invite(owner);
  const rejoined = await f.login("jason@example.com");
  const reopened = (
    await f.request(`/state?week=${previousMonday}`, undefined, rejoined)
  ).data;
  assert.deepEqual(reopened.logs.find((l) => l.member_id === 2).body, entries);
});

test("future plans save across devices while early completion remains blocked", async (t) => {
  const f = await fixture(t);
  const owner = await f.login("mike@example.com");
  await f.invite(owner);
  const member = await f.login("jason@example.com");
  const otherDevice = await f.login("jason@example.com");
  const nextMonday = addDays(
    today(),
    7 - ((new Date(today() + "T12:00:00Z").getUTCDay() + 6) % 7),
  );
  assert.equal(
    (
      await f.request(
        "/blocks",
        { planKey, start: nextMonday, weeks: 8 },
        owner,
      )
    ).status,
    200,
  );
  const exercise = plan.days.find((day) => day.weekday === 1).exercises[0];
  const entries = {
    [exercise.id]: {
      done: false,
      variant: exercise.id,
      sets: Array.from({ length: exercise.sets }, () => ({
        weight: 42.5,
        reps: 8,
      })),
      setLinking: {
        enabled: true,
        independent: Array(exercise.sets).fill(false),
      },
    },
  };
  const body = { entries, completed: false, revision: 0 };
  const path = `/logs/${nextMonday}`;
  assert.equal((await f.request(path, body, member, "PUT")).status, 200);
  const read = () =>
    f.request(`/state?week=${nextMonday}`, undefined, otherDevice);
  let saved = (await read()).data.logs[0];
  assert.deepEqual(saved.body, entries);
  assert.equal(saved.completed, 0);
  assert.equal(saved.revision, 1);
  assert.equal((await f.request(path, body, otherDevice, "PUT")).status, 409);
  for (const invalid of [
    { ...body, revision: 1, completed: true },
    {
      ...body,
      revision: 1,
      entries: { [exercise.id]: { ...entries[exercise.id], done: true } },
    },
  ]) {
    const result = await f.request(path, invalid, otherDevice, "PUT");
    assert.equal(result.status, 400);
    assert.match(result.data.error, /cannot be checked off yet/);
  }
  entries[exercise.id].sets[0].weight = 0;
  entries[exercise.id].setLinking.enabled = false;
  assert.equal(
    (await f.request(path, { ...body, revision: 1 }, otherDevice, "PUT"))
      .status,
    200,
  );
  saved = (await read()).data.logs[0];
  assert.deepEqual(saved.body, entries);
  assert.equal(saved.revision, 2);
  assert.deepEqual(
    (
      await f.request(
        `/history?before=${addDays(nextMonday, 7)}`,
        undefined,
        member,
      )
    ).data.history,
    {},
  );
  assert.equal(
    (await f.request(`/logs/${addDays(nextMonday, 1)}`, body, member, "PUT"))
      .status,
    400,
  );
  assert.equal(
    (await f.request(`/logs/${addDays(nextMonday, 56)}`, body, member, "PUT"))
      .status,
    400,
  );
  const permissions = (
    await f.db.query(
      "select prosecdef, has_function_privilege('anon',oid,'execute') as anon_access, has_function_privilege('authenticated',oid,'execute') as member_access from pg_proc where oid='public.tt_rpc(text,jsonb,text,text)'::regprocedure",
    )
  ).rows[0];
  assert.deepEqual(permissions, {
    prosecdef: false,
    anon_access: false,
    member_access: false,
  });
});
