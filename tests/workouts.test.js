import test from "node:test";
import assert from "node:assert/strict";
import {
  makeEntry,
  copyPreviousSet,
  repeatFirstSet,
} from "../shared/workouts.js";

test("previous sets prefill only matching positions and never mark an exercise complete", () => {
  const history = {
    sets: [
      { weight: 0, reps: 12 },
      { weight: 20, reps: null },
    ],
  };
  const entry = makeEntry({ id: "press", sets: 3 }, history);
  assert.deepEqual(entry, {
    done: false,
    variant: "press",
    sets: [
      { weight: 0, reps: 12 },
      { weight: 20, reps: null },
      { weight: null, reps: null },
    ],
  });
  entry.sets[0].reps = 99;
  assert.equal(history.sets[0].reps, 12);
  assert.equal(makeEntry({ id: "press", sets: 1 }, history).sets.length, 1);
});

test("copying a previous set copies weight and reps without adding or aliasing sets", () => {
  const original = {
    done: false,
    variant: "press",
    sets: [
      { weight: 55, reps: 8 },
      { weight: null, reps: null },
      { weight: 45, reps: 10 },
    ],
  };
  const copied = copyPreviousSet(original, 1);
  assert.deepEqual(copied.sets, [
    { weight: 55, reps: 8 },
    { weight: 55, reps: 8 },
    { weight: 45, reps: 10 },
  ]);
  copied.sets[1].weight = 60;
  assert.equal(copied.sets[0].weight, 55);
  assert.equal(original.sets[1].weight, null);
  assert.equal(copied.done, false);
});

test("repeating the first set preserves the planned count and independent editing", () => {
  const original = {
    done: false,
    variant: "press",
    sets: [
      { weight: 0, reps: 15 },
      { weight: null, reps: null },
      { weight: 5, reps: 10 },
    ],
  };
  const repeated = repeatFirstSet(original);
  assert.deepEqual(
    repeated.sets,
    Array.from({ length: 3 }, () => ({ weight: 0, reps: 15 })),
  );
  repeated.sets[2].weight = 5;
  assert.equal(repeated.sets[0].weight, 0);
  assert.equal(original.sets[1].weight, null);
});
