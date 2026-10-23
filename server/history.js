import { exerciseIdentity } from "../shared/workouts.js";

export function previousExercises(db, memberId, before) {
  const target = db
    .prepare(
      `SELECT p.body FROM blocks b JOIN plans p ON p.key=b.plan_key
    WHERE b.start<=? AND b.end>=?`,
    )
    .get(before, before);
  if (!target) return {};
  const day = JSON.parse(target.body).days.find(
    (day) => day.weekday === new Date(`${before}T12:00:00Z`).getUTCDay(),
  );
  if (!day) return {};
  const wanted = new Map(
    day.exercises.flatMap((exercise) =>
      [exercise, ...exercise.substitutions].map((variant) => [
        exerciseIdentity(variant),
        variant.id,
      ]),
    ),
  );
  const history = {};
  const rows = db
    .prepare(
      `SELECT l.date,l.day_id,l.body,p.body AS plan
    FROM logs l JOIN blocks b ON b.id=l.block_id JOIN plans p ON p.key=b.plan_key
    WHERE l.member_id=? AND l.date<? ORDER BY l.date DESC`,
    )
    .iterate(memberId, before);
  for (const row of rows) {
    const previousDay = JSON.parse(row.plan).days.find(
      (day) => day.id === row.day_id,
    );
    for (const [id, entry] of Object.entries(JSON.parse(row.body))) {
      // Saved suggestions are not a completed workout and must not replace actual history.
      if (
        !entry.done ||
        !entry.sets.some((set) => set.weight !== null || set.reps !== null)
      )
        continue;
      const exercise = previousDay?.exercises.find(
        (exercise) => exercise.id === id,
      );
      const variant =
        exercise &&
        [exercise, ...exercise.substitutions].find(
          (variant) => variant.id === entry.variant,
        );
      const identity = variant && exerciseIdentity(variant);
      const targetId = wanted.get(identity);
      if (targetId) {
        history[targetId] = { date: row.date, sets: entry.sets };
        wanted.delete(identity);
      }
    }
    if (!wanted.size) break;
  }
  return history;
}
