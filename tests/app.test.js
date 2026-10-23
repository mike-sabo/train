import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.js";
import { addDays, today } from "../server/schema.js";
const origin = "http://localhost:5173";
async function fixture(t, path = ":memory:", config = {}) {
  const app = createApp({
    dbPath: path,
    origin,
    production: false,
    emailMode: "development",
    ownerEmail: "mike@example.com",
    ...config,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    app.locals.db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(
    path,
    body,
    cookie = "",
    method = body ? "POST" : "GET",
    requestOrigin = origin,
  ) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        origin: requestOrigin,
        "content-type": "application/json",
        cookie,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(email) {
    const sent = await request("/auth/send", { email });
    assert.equal(sent.status, 200);
    const verified = await request("/auth/verify", {
      email,
      code: sent.data.developmentCode,
    });
    assert.equal(verified.status, 200);
    return verified.cookie;
  }
  return { app, request, login };
}
test("invitation-only email authentication, single-use codes, and owner permissions", async (t) => {
  const { request, login } = await fixture(t);
  assert.equal((await request("/state")).status, 401);
  const outsider = await request("/auth/send", {
    email: "outside@example.com",
  });
  assert.deepEqual(outsider.data, { ok: true });
  assert.equal(
    (
      await request("/auth/verify", {
        email: "outside@example.com",
        code: "123456",
      })
    ).status,
    400,
  );
  const owner = await login("mike@example.com");
  assert.equal(
    (
      await request(
        "/invites",
        { name: "Jason", email: "jason@example.com" },
        owner,
        "POST",
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/invites",
        { name: "Jason", email: "jason@example.com" },
        owner,
      )
    ).status,
    200,
  );
  const sent = await request("/auth/send", { email: "JASON@example.com" });
  const verify = await request("/auth/verify", {
    email: "jason@example.com",
    code: sent.data.developmentCode,
  });
  assert.equal(verify.status, 200);
  assert.equal(
    (
      await request("/auth/verify", {
        email: "jason@example.com",
        code: sent.data.developmentCode,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/invites",
        { name: "Other", email: "other@example.com" },
        verify.cookie,
      )
    ).status,
    403,
  );
  assert.equal((await request("/plans", {}, verify.cookie)).status, 403);
  const state = (await request("/state", undefined, verify.cookie)).data;
  assert.equal(state.me.name, "Jason");
  assert.equal(state.members.length, 2);
  assert.ok(state.members.every((m) => !("email" in m)));
  await request("/auth/logout", {}, verify.cookie);
  assert.equal((await request("/state", undefined, verify.cookie)).status, 401);
});
test("expired codes and repeated incorrect codes cannot authenticate", async (t) => {
  const { request, app } = await fixture(t);
  let sent = await request("/auth/send", { email: "mike@example.com" });
  app.locals.db.prepare("UPDATE challenges SET expires=0").run();
  assert.equal(
    (
      await request("/auth/verify", {
        email: "mike@example.com",
        code: sent.data.developmentCode,
      })
    ).status,
    400,
  );
  sent = await request("/auth/send", { email: "mike@example.com" });
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request("/auth/verify", {
          email: "mike@example.com",
          code: "000000",
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await request("/auth/verify", {
        email: "mike@example.com",
        code: sent.data.developmentCode,
      })
    ).status,
    400,
  );
});
test("workouts are durable, scoped to the signed-in member, and preserve plan versions", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "train-together-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { request, login, app } = await fixture(t, join(dir, "test.sqlite"));
  const owner = await login("mike@example.com");
  const state = (await request("/state", undefined, owner)).data;
  const plan = state.plans[0];
  const date = addDays(
    today(),
    -((new Date(today() + "T12:00:00Z").getUTCDay() + 6) % 7),
  );
  const planKey = `${plan.id}@${plan.version}`;
  assert.equal(
    (await request("/blocks", { planKey, start: date, weeks: 8 }, owner))
      .status,
    200,
  );
  assert.equal(
    (await request("/blocks", { planKey, start: date, weeks: 6 }, owner))
      .status,
    409,
  );
  const entries = Object.fromEntries(
    plan.days[0].exercises.map((e) => [
      e.id,
      {
        done: true,
        variant: e.id,
        sets: Array.from({ length: e.sets }, () => ({ weight: 40, reps: 10 })),
      },
    ]),
  );
  const log = { entries, completed: true, revision: 0, member_id: 999 };
  assert.equal((await request("/logs/" + date, log, owner, "PUT")).status, 200);
  assert.equal((await request("/logs/" + date, log, owner, "PUT")).status, 409);
  assert.equal(
    (await request("/logs/" + addDays(date, 1), log, owner, "PUT")).status,
    400,
  );
  assert.equal(
    (await request("/logs/" + addDays(today(), 7), log, owner, "PUT")).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/logs/" + date,
        { entries: {}, completed: true, revision: 1 },
        owner,
        "PUT",
      )
    ).status,
    400,
  );
  await request(
    "/invites",
    { name: "Jason", email: "jason@example.com" },
    owner,
  );
  const jason = await login("jason@example.com");
  await request(
    "/logs/" + date,
    { entries: {}, completed: false, revision: 0, member_id: 1 },
    jason,
    "PUT",
  );
  const next = { ...plan, version: 3, name: "Next block" };
  assert.equal((await request("/plans", next, owner)).status, 200);
  assert.equal((await request("/plans", next, owner)).status, 409);
  assert.equal(
    (
      await request(
        "/blocks",
        { planKey: `${plan.id}@3`, start: addDays(date, 56), weeks: 6 },
        owner,
      )
    ).status,
    200,
  );
  const result = (await request("/state?week=" + date, undefined, owner)).data;
  assert.equal(
    result.logs.find((l) => l.member_id === result.me.id).completed,
    1,
  );
  assert.equal(
    result.logs.find((l) => l.member_id !== result.me.id).completed,
    0,
  );
  assert.equal(result.plans.find((p) => p.version === 1).name, plan.name);
  assert.equal(
    result.blocks.find((b) => b.id === result.logs[0].block_id).plan_key,
    planKey,
  );
  const second = createApp({
    dbPath: join(dir, "test.sqlite"),
    production: false,
    origin,
    emailMode: "development",
  });
  assert.equal(
    second.locals.db.prepare("SELECT COUNT(*) AS count FROM logs").get().count,
    2,
  );
  second.locals.db.close();
  assert.equal(
    app.locals.db.prepare("SELECT COUNT(*) AS count FROM plans").get().count,
    3,
  );
});
test("production refuses development authentication and unconfigured owners", () => {
  assert.throws(
    () =>
      createApp({
        production: true,
        emailMode: "development",
        origin: "https://example.com",
      }),
    /Production requires/,
  );
});

test("only the admin can revoke access, and removal preserves history across a fresh invitation", async (t) => {
  const { request, login, app } = await fixture(t);
  const owner = await login("mike@example.com");
  await request(
    "/invites",
    { name: "Jason", email: "jason@example.com" },
    owner,
  );
  const jason = await login("jason@example.com");
  const member = app.locals.db
    .prepare("SELECT * FROM members WHERE email=?")
    .get("jason@example.com");
  const ownerMember = app.locals.db
    .prepare("SELECT * FROM members WHERE role='owner'")
    .get();
  const date = addDays(
    today(),
    -((new Date(today() + "T12:00:00Z").getUTCDay() + 6) % 7),
  );
  await request(
    "/blocks",
    { planKey: "three-day-foundation@2", start: date, weeks: 8 },
    owner,
  );
  await request(
    "/logs/" + date,
    { entries: {}, completed: false, revision: 0 },
    jason,
    "PUT",
  );
  const unusedCode = (await request("/auth/send", { email: member.email })).data
    .developmentCode;
  assert.equal(
    (await request(`/members/${member.id}/revoke`, {}, jason)).status,
    403,
  );
  assert.equal(
    (await request(`/members/${ownerMember.id}/revoke`, {}, owner)).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/members/${member.id}/revoke`,
        {},
        owner,
        "POST",
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(`/members/${member.id}/revoke`, {}, owner)).status,
    200,
  );
  assert.equal((await request("/state", undefined, jason)).status, 401);
  assert.equal(
    (
      await request(
        "/logs/" + date,
        { entries: {}, completed: false, revision: 1 },
        jason,
        "PUT",
      )
    ).status,
    401,
  );
  assert.equal(
    (await request("/auth/verify", { email: member.email, code: unusedCode }))
      .status,
    400,
  );
  assert.deepEqual(
    (await request("/auth/send", { email: member.email })).data,
    { ok: true },
  );
  assert.equal(
    app.locals.db
      .prepare("SELECT COUNT(*) AS n FROM logs WHERE member_id=?")
      .get(member.id).n,
    1,
  );
  assert.equal(
    app.locals.db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE member_id=?")
      .get(member.id).n,
    0,
  );
  assert.equal(
    app.locals.db
      .prepare("SELECT COUNT(*) AS n FROM challenges WHERE email=?")
      .get(member.email).n,
    0,
  );
  const adminState = (await request("/state?week=" + date, undefined, owner))
    .data;
  assert.ok(adminState.members.find((m) => m.id === member.id).removed_at);
  assert.equal(
    adminState.logs.find((l) => l.member_id === member.id).revision,
    1,
  );
  await request("/invites", { name: "Jason", email: member.email }, owner);
  const restored = app.locals.db
    .prepare("SELECT * FROM members WHERE email=?")
    .get(member.email);
  assert.equal(restored.id, member.id);
  assert.equal(restored.role, "member");
  assert.equal(restored.joined, null);
  assert.equal((await request("/state", undefined, jason)).status, 401);
  assert.equal(
    (await request("/auth/verify", { email: member.email, code: unusedCode }))
      .status,
    400,
  );
  // Expire the send limit so a fresh sign-in can be tested without waiting ten minutes.
  app.locals.db
    .prepare("UPDATE limits SET expires=0 WHERE key=?")
    .run(`send:${member.email}`);
  const freshSession = await login(member.email);
  const restoredState = (
    await request("/state?week=" + date, undefined, freshSession)
  ).data;
  assert.equal(restoredState.me.id, member.id);
  assert.equal(
    restoredState.logs.find((l) => l.member_id === member.id).revision,
    1,
  );
});

test("pending invitations can be revoked and members cannot grant themselves privileges", async (t) => {
  const { request, login, app } = await fixture(t);
  const owner = await login("mike@example.com");
  assert.equal(
    (
      await request(
        "/invites",
        { name: "Intruder", email: "intruder@example.com", role: "owner" },
        owner,
      )
    ).status,
    400,
  );
  await request(
    "/invites",
    { name: "Jason", email: "jason@example.com" },
    owner,
  );
  const member = app.locals.db
    .prepare("SELECT * FROM members WHERE email=?")
    .get("jason@example.com");
  const code = (await request("/auth/send", { email: member.email })).data
    .developmentCode;
  assert.equal(
    (await request(`/members/${member.id}/revoke`, {}, owner)).status,
    200,
  );
  assert.equal(
    (await request("/auth/verify", { email: member.email, code })).status,
    400,
  );
  assert.equal(
    (await request(`/members/${member.id}/revoke`, {}, owner)).status,
    200,
  );
  await request("/invites", { name: "Jason", email: member.email }, owner);
  const jason = await login(member.email);
  for (const path of [
    "/invites",
    "/plans",
    "/blocks",
    `/members/${member.id}/revoke`,
  ]) {
    assert.equal((await request(path, {}, jason)).status, 403);
  }
  assert.equal(
    (await request("/setup", { email: member.email }, jason)).status,
    403,
  );
  assert.equal(
    app.locals.db
      .prepare("SELECT COUNT(*) AS n FROM members WHERE role='owner'")
      .get().n,
    1,
  );
  assert.throws(
    () =>
      app.locals.db
        .prepare("UPDATE members SET role='owner' WHERE id=?")
        .run(member.id),
    /UNIQUE/,
  );
});

test("member responses reveal group completion without other members' private logs or emails", async (t) => {
  const { request, login, app } = await fixture(t);
  const owner = await login("mike@example.com");
  const initial = (await request("/state", undefined, owner)).data;
  const date = addDays(
    today(),
    -((new Date(today() + "T12:00:00Z").getUTCDay() + 6) % 7),
  );
  await request(
    "/blocks",
    { planKey: "three-day-foundation@1", start: date, weeks: 8 },
    owner,
  );
  const entries = Object.fromEntries(
    initial.plans[0].days[0].exercises.map((e) => [
      e.id,
      {
        done: true,
        variant: e.id,
        sets: Array.from({ length: e.sets }, () => ({ weight: 120, reps: 10 })),
      },
    ]),
  );
  await request(
    "/logs/" + date,
    { entries, completed: true, revision: 0 },
    owner,
    "PUT",
  );
  await request(
    "/invites",
    { name: "Jason", email: "jason@example.com" },
    owner,
  );
  const jason = await login("jason@example.com");
  const state = (await request("/state?week=" + date, undefined, jason)).data;
  assert.deepEqual(state.logs[0], {
    member_id: initial.me.id,
    date,
    completed: 1,
  });
  assert.ok(state.members.every((m) => !("email" in m)));
  const adminState = (await request("/state?week=" + date, undefined, owner))
    .data;
  assert.deepEqual(adminState.logs[0].body, entries);
  assert.equal(
    adminState.members.find((m) => m.name === "Jason").email,
    "jason@example.com",
  );
  const id = app.locals.db
    .prepare("SELECT id FROM members WHERE email=?")
    .get("jason@example.com").id;
  await request(`/members/${id}/revoke`, {}, owner);
  await request(
    "/invites",
    { name: "Friend", email: "friend@example.com" },
    owner,
  );
  const friend = await login("friend@example.com");
  assert.ok(
    !(await request("/state", undefined, friend)).data.members.some(
      (m) => m.id === id,
    ),
  );
});

test("changing OWNER_EMAIL cannot create another admin or promote an existing member", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "train-together-owner-test-"));
  const path = join(dir, "test.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { request, login, app } = await fixture(t, path);
  const owner = await login("mike@example.com");
  await request(
    "/invites",
    { name: "Jason", email: "jason@example.com" },
    owner,
  );
  for (const email of ["jason@example.com", "another@example.com"]) {
    assert.throws(
      () =>
        createApp({
          dbPath: path,
          production: false,
          emailMode: "development",
          ownerEmail: email,
        }),
      /existing admin/,
    );
  }
  const restarted = createApp({
    dbPath: path,
    production: false,
    emailMode: "development",
    ownerEmail: "MIKE@example.com",
  });
  restarted.locals.db.close();
  assert.equal(
    app.locals.db
      .prepare("SELECT COUNT(*) AS n FROM members WHERE role='owner'")
      .get().n,
    1,
  );
});

test("upgrading existing accounts preserves their roles, sessions, and active status", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "train-together-upgrade-test-"));
  const path = join(dir, "test.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE members(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','member')),joined INTEGER);
    CREATE TABLE sessions(token TEXT PRIMARY KEY,member_id INTEGER REFERENCES members(id),expires INTEGER NOT NULL);
    INSERT INTO members VALUES (1,'Mike','mike@example.com','owner',1),(2,'Jason','jason@example.com','member',2);
    INSERT INTO sessions VALUES ('existing-session',2,9999999999999);
  `);
  old.close();
  const { app, login, request } = await fixture(t, path);
  const accounts = app.locals.db
    .prepare(
      "SELECT id,role,joined,removed_at,access_version FROM members ORDER BY id",
    )
    .all();
  assert.deepEqual(
    accounts.map((row) => ({ ...row })),
    [
      { id: 1, role: "owner", joined: 1, removed_at: null, access_version: 0 },
      { id: 2, role: "member", joined: 2, removed_at: null, access_version: 0 },
    ],
  );
  assert.equal(
    app.locals.db
      .prepare("SELECT member_id FROM sessions WHERE token='existing-session'")
      .get().member_id,
    2,
  );
  const member = await login("jason@example.com");
  assert.equal(
    (await request("/state", undefined, member)).data.me.role,
    "member",
  );
});

test("an email finishing after revocation and re-invitation cannot restore the old sign-in code", async (t) => {
  const savedKey = process.env.RESEND_API_KEY;
  const savedFrom = process.env.EMAIL_FROM;
  process.env.RESEND_API_KEY = "test-only-key";
  process.env.EMAIL_FROM = "test@example.com";
  t.after(() => {
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
    if (savedFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = savedFrom;
  });
  const originalFetch = globalThis.fetch;
  const messages = [];
  let delayNextCode = false;
  let finishDelivery;
  let deliveryStarted;
  const started = new Promise((resolve) => {
    deliveryStarted = resolve;
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url !== "https://api.resend.com/emails")
      return originalFetch(url, options);
    const message = JSON.parse(options.body);
    messages.push(message);
    if (
      delayNextCode &&
      message.subject === "Your Train Together sign-in code"
    ) {
      delayNextCode = false;
      await new Promise((resolve) => {
        finishDelivery = resolve;
        deliveryStarted();
      });
    }
    return new Response("{}", { status: 200 });
  });
  const { app, request } = await fixture(t, ":memory:", {
    emailMode: "resend",
  });
  await request("/auth/send", { email: "mike@example.com" });
  const ownerCode = messages.at(-1).text.match(/\b\d{6}\b/)[0];
  const owner = (
    await request("/auth/verify", {
      email: "mike@example.com",
      code: ownerCode,
    })
  ).cookie;
  assert.ok(owner);
  assert.equal(
    (
      await request(
        "/invites",
        { name: "Jason", email: "jason@example.com" },
        owner,
      )
    ).status,
    200,
  );
  const memberId = app.locals.db
    .prepare("SELECT id FROM members WHERE email='jason@example.com'")
    .get().id;
  delayNextCode = true;
  const pending = request("/auth/send", { email: "jason@example.com" });
  await started;
  const staleCode = messages.at(-1).text.match(/\b\d{6}\b/)[0];
  try {
    assert.equal(
      (await request(`/members/${memberId}/revoke`, {}, owner)).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/invites",
          { name: "Jason", email: "jason@example.com" },
          owner,
        )
      ).status,
      200,
    );
  } finally {
    finishDelivery();
  }
  assert.equal((await pending).status, 200);
  assert.equal(
    app.locals.db
      .prepare("SELECT * FROM challenges WHERE email='jason@example.com'")
      .get(),
    undefined,
  );
  assert.equal(
    (
      await request("/auth/verify", {
        email: "jason@example.com",
        code: staleCode,
      })
    ).status,
    400,
  );
});
