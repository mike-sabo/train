import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestPlanVersions } from "../shared/plans.js";
import { database } from "../server/db.js";
import { planSchema } from "../server/schema.js";

const readPlan = (version) =>
  JSON.parse(
    readFileSync(
      new URL(`../plans/foundation-v${version}.json`, import.meta.url),
    ),
  );

test("Foundation version 5 gives every exercise and substitution three sets while preserving the routine", () => {
  const previous = readPlan(4);
  const current = readPlan(5);
  assert.equal(planSchema.safeParse(current).success, true);
  assert.equal(current.version, 5);
  assert.equal(current.id, previous.id);
  let substitutions = 0;
  for (const day of current.days) {
    for (const exercise of day.exercises) {
      for (const variant of [exercise, ...exercise.substitutions]) {
        assert.equal(variant.sets, 3, `${day.id}: ${variant.id}`);
      }
      substitutions += exercise.substitutions.length;
    }
  }
  assert.ok(
    substitutions > 0,
    "The optional landmine squat must remain available.",
  );
  const withoutSetCounts = (plan) =>
    JSON.parse(JSON.stringify(plan.days), (key, value) =>
      key === "sets" ? undefined : value,
    );
  assert.deepEqual(withoutSetCounts(current), withoutSetCounts(previous));
  for (const field of ["schemaVersion", "name", "schedule", "weeks", "notes"])
    assert.deepEqual(current[field], previous[field]);
});

test("local seeding adds version 5 without changing older plans, pinned blocks, or completed logs", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "train-plan-upgrade-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "test.sqlite");
  let db = database(path);
  t.after(() => db.close());
  db.prepare("DELETE FROM plans WHERE key=?").run("three-day-foundation@5");
  db.exec(`INSERT INTO members(id,name,email,role) VALUES(1,'Test','test@example.com','owner');
    INSERT INTO blocks VALUES(1,'three-day-foundation@4','2026-10-19','2026-12-13',8)`);
  const previous = readPlan(4);
  const entries = Object.fromEntries(
    previous.days[0].exercises.map((exercise) => [
      exercise.id,
      {
        done: true,
        variant: exercise.id,
        sets: Array.from({ length: exercise.sets }, () => ({
          weight: 40,
          reps: 10,
        })),
      },
    ]),
  );
  db.prepare("INSERT INTO logs VALUES(1,'2026-10-19',1,'monday',?,1,1)").run(
    JSON.stringify(entries),
  );
  const savedPlans = db.prepare("SELECT * FROM plans ORDER BY key").all();
  const savedBlocks = db.prepare("SELECT * FROM blocks").all();
  const savedLogs = db.prepare("SELECT * FROM logs").all();
  db.close();
  db = database(path);
  assert.deepEqual(
    db
      .prepare("SELECT * FROM plans WHERE key<>? ORDER BY key")
      .all("three-day-foundation@5"),
    savedPlans,
  );
  assert.deepEqual(db.prepare("SELECT * FROM blocks").all(), savedBlocks);
  assert.deepEqual(db.prepare("SELECT * FROM logs").all(), savedLogs);
  const plans = db
    .prepare("SELECT body FROM plans")
    .all()
    .map((row) => JSON.parse(row.body));
  assert.equal(plans.length, 5);
  for (const plan of plans)
    assert.deepEqual(plan, planSchema.parse(readPlan(plan.version)));
  assert.deepEqual(latestPlanVersions(plans), [planSchema.parse(readPlan(5))]);
});

test("the plan picker shows the latest revision while retaining older plans for history", () => {
  const plans = Object.freeze([
    Object.freeze({ id: "foundation", version: 3 }),
    Object.freeze({ id: "foundation", version: 10 }),
    Object.freeze({ id: "foundation", version: 2 }),
    Object.freeze({ id: "foundation", version: 4 }),
  ]);
  assert.deepEqual(latestPlanVersions(plans), [plans[1]]);
  assert.equal(plans.length, 4);
  assert.equal(
    plans.find((plan) => plan.version === 3),
    plans[0],
  );
  const nextRoutine = { id: "next-routine", version: 1 };
  assert.deepEqual(latestPlanVersions([...plans, nextRoutine]), [
    plans[1],
    nextRoutine,
  ]);
  assert.deepEqual(latestPlanVersions([]), []);
});
