import express from "express";
import { randomBytes, randomInt, createHash } from "node:crypto";
import { z } from "zod";
import { database } from "./db.js";
import { planSchema, dateSchema, addDays, today } from "./schema.js";
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export function createApp(config = {}) {
  const production = config.production ?? process.env.NODE_ENV === "production";
  const origin =
    config.origin ?? process.env.APP_ORIGIN ?? "http://localhost:5173";
  const emailMode = config.emailMode ?? process.env.EMAIL_MODE ?? "development";
  const ownerEmail = config.ownerEmail ?? process.env.OWNER_EMAIL;
  if (
    production &&
    (emailMode !== "resend" || !ownerEmail || !origin.startsWith("https://"))
  )
    throw new Error(
      "Production requires EMAIL_MODE=resend, OWNER_EMAIL, and an HTTPS APP_ORIGIN.",
    );
  const mailKey = process.env.RESEND_API_KEY,
    mailFrom = process.env.EMAIL_FROM;
  if (emailMode === "resend" && (!mailKey || !mailFrom))
    throw new Error("Configure RESEND_API_KEY and EMAIL_FROM.");
  const db = database(
    config.dbPath ?? process.env.DB_PATH ?? "data/train-together.sqlite",
  );
  if (ownerEmail) {
    emailSchema.parse(ownerEmail);
    db.prepare(
      "INSERT OR IGNORE INTO members(name,email,role) VALUES ('Mike',?,'owner')",
    ).run(emailSchema.parse(ownerEmail));
  }
  const app = express();
  app.disable("x-powered-by");
  app.locals.db = db;
  app.use(express.json({ limit: "128kb" }));
  app.use("/api", (req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== origin)
      return res
        .status(403)
        .json({ error: "This request must come from Train Together." });
    next();
  });
  function limit(key, max, ms) {
    const now = Date.now();
    db.prepare("DELETE FROM limits WHERE expires < ?").run(now);
    const r = db.prepare("SELECT * FROM limits WHERE key=?").get(key);
    if (r && r.count >= max)
      fail(429, "Too many attempts. Please wait before trying again.");
    db.prepare(
      "INSERT INTO limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    ).run(key, 1, now + ms);
  }
  const getMember = (email) =>
    db.prepare("SELECT * FROM members WHERE email=?").get(email);
  async function sendEmail(email, subject, text) {
    if (emailMode === "development") return;
    limit(
      "email-budget:" + new Date().toISOString().slice(0, 10),
      90,
      86400000,
    );
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mailKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: mailFrom, to: [email], subject, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      fail(502, "Email delivery failed. Please try again shortly.");
  }
  function session(req, res, member) {
    const token = randomBytes(32).toString("hex");
    const old = req.headers.cookie?.match(
      /(?:^|; )tt_session=([a-f0-9]{64})/,
    )?.[1];
    if (old) db.prepare("DELETE FROM sessions WHERE token=?").run(hash(old));
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      hash(token),
      member.id,
      Date.now() + 30 * 86400000,
    );
    res.cookie("tt_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: production,
      maxAge: 30 * 86400000,
      path: "/",
    });
  }
  function auth(req, res, next) {
    const token = req.headers.cookie?.match(
      /(?:^|; )tt_session=([a-f0-9]{64})/,
    )?.[1];
    req.member =
      token &&
      db
        .prepare(
          "SELECT m.* FROM members m JOIN sessions s ON s.member_id=m.id WHERE s.token=? AND s.expires>?",
        )
        .get(hash(token), Date.now());
    if (!req.member)
      return res.status(401).json({ error: "Please sign in to your account." });
    next();
  }
  function owner(req, res, next) {
    if (req.member.role !== "owner")
      return res
        .status(403)
        .json({
          error: "Only Mike’s owner account can manage invitations and plans.",
        });
    next();
  }
  app.get("/api/status", (_req, res) =>
    res.json({
      emailMode: emailMode,
      setup: !db.prepare("SELECT id FROM members LIMIT 1").get(),
      today: today(),
    }),
  );
  // First-run setup is available only on a loopback development server. Production seeds a configured owner email.
  app.post("/api/setup", (req, res) => {
    if (production || db.prepare("SELECT id FROM members LIMIT 1").get())
      fail(403, "Setup is already complete.");
    const email = emailSchema.parse(req.body.email);
    db.prepare(
      "INSERT INTO members(name,email,role) VALUES ('Mike',?,'owner')",
    ).run(email);
    res.json({ ok: true });
  });
  app.post("/api/auth/send", async (req, res) => {
    const email = emailSchema.parse(req.body.email);
    limit(`send-ip:${req.socket.remoteAddress}`, 15, 3600000);
    limit(`send:${email}`, 3, 600000);
    if (!getMember(email)) return res.json({ ok: true });
    const code = String(randomInt(100000, 1000000));
    await sendEmail(
      email,
      "Your Train Together sign-in code",
      `Your code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`,
    );
    db.prepare(
      "INSERT OR REPLACE INTO challenges(email,code_hash,expires,attempts) VALUES (?,?,?,0)",
    ).run(email, hash(code), Date.now() + 600000);
    res.json({
      ok: true,
      ...(emailMode === "development" ? { developmentCode: code } : {}),
    });
  });
  app.post("/api/auth/verify", async (req, res) => {
    const { email, code } = z
      .object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) })
      .parse(req.body);
    limit(`verify-ip:${req.socket.remoteAddress}`, 30, 600000);
    limit(`verify:${email}`, 10, 600000);
    const member = getMember(email);
    if (!member) fail(400, "Invalid or expired code.");
    let approved = false;
    {
      const c = db.prepare("SELECT * FROM challenges WHERE email=?").get(email);
      if (c) {
        db.prepare(
          "UPDATE challenges SET attempts=attempts+1 WHERE email=?",
        ).run(email);
        approved =
          c.expires > Date.now() &&
          c.attempts < 5 &&
          c.code_hash === hash(code);
      }
    }
    if (!approved) fail(400, "Invalid or expired code.");
    db.prepare("DELETE FROM challenges WHERE email=?").run(email);
    db.prepare("UPDATE members SET joined=COALESCE(joined,?) WHERE id=?").run(
      Date.now(),
      member.id,
    );
    session(req, res, member);
    res.json({ ok: true });
  });
  app.post("/api/auth/logout", auth, (req, res) => {
    const token = req.headers.cookie.match(
      /(?:^|; )tt_session=([a-f0-9]{64})/,
    )[1];
    db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
    res.clearCookie("tt_session", { path: "/" });
    res.json({ ok: true });
  });
  app.use("/api", auth);
  app.get("/api/state", (req, res) => {
    const week = dateSchema.parse(req.query.week ?? today());
    const end = addDays(week, 6);
    const members = db.prepare("SELECT id,name,role,joined FROM members").all();
    const logs = db
      .prepare(
        "SELECT member_id,date,block_id,day_id,body,completed,revision FROM logs WHERE date BETWEEN ? AND ?",
      )
      .all(week, end)
      .map((l) => ({ ...l, body: JSON.parse(l.body) }));
    res.json({
      me: { id: req.member.id, name: req.member.name, role: req.member.role },
      members,
      plans: db
        .prepare("SELECT body FROM plans")
        .all()
        .map((p) => JSON.parse(p.body)),
      blocks: db.prepare("SELECT * FROM blocks ORDER BY start").all(),
      logs,
    });
  });
  app.post("/api/invites", owner, async (req, res) => {
    const { email, name } = z
      .object({ email: emailSchema, name: z.string().trim().min(1).max(60) })
      .parse(req.body);
    if (getMember(email)) fail(409, "That email address is already invited.");
    await sendEmail(
      email,
      "You’re invited to Train Together",
      `Mike has invited you to Train Together. Accept your invitation by signing in with this email address at ${origin}/workout-plan/. We will email you a verification code. Iron sharpens iron. — Proverbs 27:17`,
    );
    db.prepare(
      "INSERT INTO members(name,email,role) VALUES (?,?,'member')",
    ).run(name, email);
    res.json({
      ok: true,
      message:
        emailMode === "development"
          ? `${name} is invited locally. No email was sent in development mode.`
          : `Invitation emailed to ${name}.`,
    });
  });
  app.post("/api/plans", owner, (req, res) => {
    const p = planSchema.parse(req.body),
      key = `${p.id}@${p.version}`;
    if (db.prepare("SELECT key FROM plans WHERE key=?").get(key))
      fail(
        409,
        "That plan version exists. Increase the version to preserve workout history.",
      );
    db.prepare("INSERT INTO plans VALUES (?,?)").run(key, JSON.stringify(p));
    res.json({ ok: true });
  });
  app.post("/api/blocks", owner, (req, res) => {
    const { planKey, start, weeks } = z
      .object({
        planKey: z.string(),
        start: dateSchema,
        weeks: z.number().int().min(1).max(52),
      })
      .parse(req.body);
    if (!db.prepare("SELECT key FROM plans WHERE key=?").get(planKey))
      fail(400, "Choose an existing plan.");
    const end = addDays(start, weeks * 7 - 1);
    if (
      db
        .prepare("SELECT id FROM blocks WHERE start<=? AND end>=?")
        .get(end, start)
    )
      fail(
        409,
        "This block overlaps an existing training block. Choose a later start date.",
      );
    db.prepare(
      "INSERT INTO blocks(plan_key,start,end,weeks) VALUES (?,?,?,?)",
    ).run(planKey, start, end, weeks);
    res.json({ ok: true });
  });
  app.put("/api/logs/:date", (req, res) => {
    const date = dateSchema.parse(req.params.date);
    if (date > today()) fail(400, "Future workouts cannot be logged yet.");
    const data = z
      .object({
        revision: z.number().int().min(0),
        entries: z.record(
          z.string(),
          z.object({
            done: z.boolean(),
            variant: z.string(),
            sets: z
              .array(
                z.object({
                  weight: z.number().min(0).max(3000).nullable(),
                  reps: z.number().int().min(0).max(1000).nullable(),
                }),
              )
              .max(10),
          }),
        ),
        completed: z.boolean(),
      })
      .parse(req.body);
    const block = db
      .prepare(
        "SELECT b.*,p.body FROM blocks b JOIN plans p ON p.key=b.plan_key WHERE b.start<=? AND b.end>=?",
      )
      .get(date, date);
    if (!block) fail(400, "No training block is scheduled for this date.");
    const plan = JSON.parse(block.body),
      day = plan.days.find(
        (d) => d.weekday === new Date(`${date}T12:00:00Z`).getUTCDay(),
      );
    if (!day) fail(400, "This is a recovery day.");
    for (const [id, entry] of Object.entries(data.entries)) {
      const e = day.exercises.find((e) => e.id === id);
      const variant =
        e && [e, ...e.substitutions].find((v) => v.id === entry.variant);
      if (!variant || entry.sets.length !== variant.sets)
        fail(400, "The log does not match this plan.");
    }
    if (data.completed && !day.exercises.every((e) => data.entries[e.id]?.done))
      fail(400, "Check off each exercise before completing your workout.");
    const old = db
      .prepare("SELECT * FROM logs WHERE member_id=? AND date=?")
      .get(req.member.id, date);
    if ((old?.revision ?? 0) !== data.revision)
      fail(
        409,
        "This workout changed on another device. Reload before saving again.",
      );
    const revision = data.revision + 1;
    db.prepare(
      "INSERT INTO logs VALUES (?,?,?,?,?,?,?) ON CONFLICT(member_id,date) DO UPDATE SET body=excluded.body,completed=excluded.completed,revision=excluded.revision",
    ).run(
      req.member.id,
      date,
      block.id,
      day.id,
      JSON.stringify(data.entries),
      Number(data.completed),
      revision,
    );
    res.json({ ok: true, revision });
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  app.use((err, _req, res, _next) => {
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: err.issues.map((i) => i.message).join(" ") });
    res
      .status(err.status ?? 500)
      .json({
        error: err.status
          ? err.message
          : "Something went wrong. Please try again.",
      });
  });
  return app;
}
