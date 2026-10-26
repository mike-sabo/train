import test from "node:test";
import assert from "node:assert/strict";
import {
  makeEntry,
  groupExercises,
  getSetLinking,
  editSet,
  setSameForAll,
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

test("set 1 automatically fills blank later sets without completing or sharing rows", () => {
  const original = makeEntry({ id: "press", sets: 3 });
  assert.equal(getSetLinking(original).enabled, true);
  const weighted = editSet(original, 0, "weight", 55);
  const filled = editSet(weighted, 0, "reps", 8);
  assert.deepEqual(
    filled.sets,
    Array.from({ length: 3 }, () => ({ weight: 55, reps: 8 })),
  );
  assert.equal(filled.done, false);
  filled.sets[1].weight = 60;
  assert.equal(filled.sets[0].weight, 55);
  assert.equal(original.sets[0].weight, null);
  assert.equal(weighted.sets[0].reps, null);
});

test("editing a later set detaches both fields, even if its value still matches set 1", () => {
  let entry = editSet(makeEntry({ id: "press", sets: 3 }), 0, "weight", 55);
  entry = editSet(entry, 0, "reps", 8);
  entry = editSet(entry, 1, "reps", 8);
  entry = editSet(entry, 0, "weight", 60);
  entry = editSet(entry, 0, "reps", 10);
  assert.deepEqual(entry.sets, [
    { weight: 60, reps: 10 },
    { weight: 55, reps: 8 },
    { weight: 60, reps: 10 },
  ]);
  assert.deepEqual(entry.setLinking.independent, [false, true, false]);
  const restored = JSON.parse(JSON.stringify(entry));
  assert.equal(editSet(restored, 0, "weight", 65).sets[1].weight, 55);
});

test("turning automatic fill off preserves values and re-enabling it preserves custom sets", () => {
  let entry = editSet(makeEntry({ id: "press", sets: 3 }), 0, "weight", 55);
  entry = setSameForAll(entry, false);
  entry = editSet(entry, 0, "weight", 60);
  assert.deepEqual(
    entry.sets.map((s) => s.weight),
    [60, 55, 55],
  );
  entry = editSet(entry, 2, "weight", 50);
  entry = setSameForAll(entry, true);
  assert.deepEqual(
    entry.sets.map((s) => s.weight),
    [60, 60, 50],
  );
  entry = editSet(entry, 0, "weight", 65);
  assert.deepEqual(
    entry.sets.map((s) => s.weight),
    [65, 65, 50],
  );
});

test("different historical sets remain unchanged until automatic fill is explicitly enabled", () => {
  const history = {
    sets: [
      { weight: 40, reps: 12 },
      { weight: 45, reps: 10 },
      { weight: 50, reps: 8 },
    ],
  };
  const entry = makeEntry({ id: "press", sets: 3 }, history);
  assert.deepEqual(entry.sets, history.sets);
  assert.equal(getSetLinking(entry).enabled, false);
  const edited = editSet(entry, 0, "weight", 42.5);
  assert.deepEqual(edited.sets.slice(1), history.sets.slice(1));
  const linked = setSameForAll(edited, true);
  assert.deepEqual(
    linked.sets,
    Array.from({ length: 3 }, () => ({ weight: 42.5, reps: 12 })),
  );
  assert.deepEqual(entry.sets, history.sets);
  assert.equal(linked.done, false);
});

test("matching history follows set 1, including zero and cleared values", () => {
  const history = {
    sets: [
      { weight: 10, reps: 15 },
      { weight: 10, reps: 15 },
    ],
  };
  let entry = makeEntry({ id: "calf", sets: 3 }, history);
  assert.equal(getSetLinking(entry).enabled, true);
  entry = editSet(entry, 0, "weight", 0);
  assert.deepEqual(
    entry.sets,
    Array.from({ length: 3 }, () => ({ weight: 0, reps: 15 })),
  );
  entry = editSet(entry, 0, "reps", null);
  assert.deepEqual(
    entry.sets,
    Array.from({ length: 3 }, () => ({ weight: 0, reps: null })),
  );
});

test("one-set exercises and resetting to history keep the original planned count", () => {
  let entry = editSet(makeEntry({ id: "press", sets: 1 }), 0, "weight", 20);
  assert.equal(entry.sets.length, 1);
  const history = {
    sets: [
      { weight: 25, reps: 10 },
      { weight: 25, reps: 10 },
    ],
  };
  entry = editSet(
    makeEntry({ id: "press", sets: 2 }, history),
    1,
    "weight",
    30,
  );
  assert.equal(entry.setLinking.independent[1], true);
  const reset = makeEntry({ id: "press", sets: 2 }, history);
  assert.deepEqual(getSetLinking(reset), {
    enabled: true,
    independent: [false, false],
  });
  assert.deepEqual(reset.sets, history.sets);
});

test("body groups keep the first group order and the exercise order within each group", () => {
  const exercises = [
    { id: "leg-press", name: "Leg Press Machine" },
    { id: "chest-press", name: "Dumbbell Chest Press" },
    { id: "landmine-press", name: "Landmine Shoulder Press" },
    { id: "leg-extension", name: "Leg Extension Machine" },
    { id: "lateral-raise", name: "Dumbbell Lateral Raise" },
    { id: "calf-raise", name: "Leg Press Calf Raise" },
    { id: "row", name: "Chest-Supported Row Machine" },
    { id: "new", name: "Unfamiliar Movement" },
  ];
  const original = structuredClone(exercises);
  const groups = groupExercises(exercises);
  assert.deepEqual(
    groups.map((group) => group.name),
    ["Legs", "Chest", "Shoulders", "Back", "Other exercises"],
  );
  assert.deepEqual(
    groups[0].exercises.map((exercise) => exercise.id),
    ["leg-press", "leg-extension", "calf-raise"],
  );
  assert.deepEqual(
    groups[2].exercises.map((exercise) => exercise.id),
    ["landmine-press", "lateral-raise"],
  );
  assert.equal(groups[0].exercises[0], exercises[0]);
  assert.deepEqual(exercises, original);
  assert.equal(
    groups.flatMap((group) => group.exercises).length,
    exercises.length,
  );
  assert.deepEqual(groupExercises([]), []);
});
