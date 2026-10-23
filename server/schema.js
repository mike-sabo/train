import { z } from "zod";
const id = z.string().regex(/^[a-z0-9-]{1,80}$/);
const demo = z.object({
  instructor: z.string().min(1).max(100),
  url: z.string().regex(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/),
  verifiedOn: z.iso.date(),
  verification: z.string().min(1).max(300),
  startSeconds: z.number().int().min(0).max(86400).optional(),
  caption: z.string().min(1).max(100).optional(),
});
const exercise = z.object({
  id,
  name: z.string().min(1).max(100),
  sets: z.number().int().min(1).max(10),
  reps: z.string().min(1).max(40),
  demo,
  substitutions: z
    .array(
      z.object({
        id,
        name: z.string().min(1).max(100),
        sets: z.number().int().min(1).max(10),
        reps: z.string().min(1).max(40),
        demo,
      }),
    )
    .max(5)
    .default([]),
});
export const planSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    version: z.number().int().positive(),
    name: z.string().min(1).max(100),
    description: z.string().max(500),
    schedule: z.string().max(100),
    weeks: z.number().int().min(1).max(52),
    notes: z.array(z.string().max(500)).max(10),
    days: z
      .array(
        z.object({
          id,
          weekday: z.number().int().min(0).max(6),
          name: z.string().min(1).max(40),
          focus: z.string().min(1).max(100),
          exercises: z.array(exercise).min(1).max(20),
        }),
      )
      .min(1)
      .max(7),
  })
  .superRefine((p, ctx) => {
    if (
      new Set(p.days.map((d) => d.id)).size !== p.days.length ||
      new Set(p.days.map((d) => d.weekday)).size !== p.days.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Days must have unique IDs and weekdays.",
      });
    for (const d of p.days) {
      const ids = d.exercises.flatMap((e) => [
        e.id,
        ...e.substitutions.map((s) => s.id),
      ]);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: "custom",
          message: "Exercise and substitution IDs must be unique within a day.",
        });
    }
  });
export const dateSchema = z.iso.date();
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
}

export const logSchema = z.object({
  revision: z.number().int().min(0),
  entries: z.record(
    z.string(),
    z.object({
      done: z.boolean(),
      variant: z.string(),
      setLinking: z
        .object({
          enabled: z.boolean(),
          independent: z.array(z.boolean()).max(10),
        })
        .optional(),
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
});
