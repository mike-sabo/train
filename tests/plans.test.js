import test from "node:test";
import assert from "node:assert/strict";
import { latestPlanVersions } from "../shared/plans.js";

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
