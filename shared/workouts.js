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

export function copyPreviousSet(entry, index) {
  if (index < 1 || index >= entry.sets.length) return entry;
  return {
    ...entry,
    sets: entry.sets.map((set, i) => ({
      ...(i === index ? entry.sets[index - 1] : set),
    })),
  };
}

export function repeatFirstSet(entry) {
  return { ...entry, sets: entry.sets.map(() => ({ ...entry.sets[0] })) };
}
