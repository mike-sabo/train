export function latestPlanVersions(plans) {
  const latest = new Map();
  for (const plan of plans) {
    if (!latest.has(plan.id) || plan.version > latest.get(plan.id).version) {
      latest.set(plan.id, plan);
    }
  }
  return [...latest.values()];
}
