import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { addDays, today } from "../server/schema.js";
const origin = "http://localhost:5173";
async function fixture(t, path = ":memory:") {
  const app = createApp({
    dbPath: path,
    origin,
    production: false,
    emailMode: "development",
    ownerEmail: "mike@example.com",
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
  const next = { ...plan, version: 2, name: "Next block" };
  assert.equal((await request("/plans", next, owner)).status, 200);
  assert.equal((await request("/plans", next, owner)).status, 409);
  assert.equal(
    (
      await request(
        "/blocks",
        { planKey: `${plan.id}@2`, start: addDays(date, 56), weeks: 6 },
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
    2,
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
