// Matching both ID and name avoids carrying a load into an unrelated renamed exercise.
export const exerciseIdentity = (exercise) =>
  `${exercise.id}:${exercise.name.trim().toLowerCase()}`;

export function makeEntry(variant, previous) {
  return {
    done: false,
    variant: variant.id,
    sets: Array.from({ length: variant.sets }, (_, index) => ({
      weight: previous?.sets[index]?.weight ?? null,
      reps: previous?.sets[index]?.reps ?? null,
    })),
  };
}

export function getSetLinking(entry) {
  if (entry.setLinking) return entry.setLinking;
  const first = entry.sets[0];
  return {
    // Keep varied history intact until the person explicitly enables automatic fill.
    enabled: entry.sets.every(
      (set) =>
        (set.weight === null && set.reps === null) ||
        (set.weight === first.weight && set.reps === first.reps),
    ),
    independent: entry.sets.map(() => false),
  };
}

function fillFollowingSets(sets, linking) {
  return sets.map((set, index) => ({
    ...(linking.enabled && index > 0 && !linking.independent[index]
      ? sets[0]
      : set),
  }));
}

export function editSet(entry, index, field, value) {
  const current = getSetLinking(entry);
  const linking = { ...current, independent: [...current.independent] };
  // Editing either field makes the whole row independent, including after a save.
  if (index > 0) linking.independent[index] = true;
  let sets = entry.sets.map((set, position) => ({
    ...set,
    ...(position === index ? { [field]: value } : {}),
  }));
  if (index === 0) sets = fillFollowingSets(sets, linking);
  return { ...entry, sets, setLinking: linking };
}

export function setSameForAll(entry, enabled) {
  const current = getSetLinking(entry);
  const linking = { enabled, independent: [...current.independent] };
  return {
    ...entry,
    sets: fillFollowingSets(entry.sets, linking),
    setLinking: linking,
  };
}

// Group by the planned exercise, so choosing a variation never moves its card.
export function groupExercises(exercises) {
  const groups = new Map();
  for (const exercise of exercises) {
    const name = exercise.name.toLowerCase();
    const group = /row|pulldown|pull-up|chin-up/.test(name)
      ? "Back"
      : /leg|squat|deadlift|glute|hip thrust|calf|lunge/.test(name)
        ? "Legs"
        : /chest|bench|fly/.test(name)
          ? "Chest"
          : /shoulder|landmine.*press|lateral raise|overhead press/.test(name)
            ? "Shoulders"
            : /tricep/.test(name)
              ? "Triceps"
              : /bicep/.test(name)
                ? "Biceps"
                : /abdominal|crunch|plank|core/.test(name)
                  ? "Core"
                  : "Other exercises";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(exercise);
  }
  return [...groups].map(([name, exercises]) => ({ name, exercises }));
}
