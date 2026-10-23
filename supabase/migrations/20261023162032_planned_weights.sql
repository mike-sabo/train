-- Keep the existing account checks and permissions while allowing future plans.
do $migration$
declare
  definition text := pg_get_functiondef('public.tt_rpc(text,jsonb,text,text)'::regprocedure);
  previous_rule text := $rule$    if log_date>(current_timestamp at time zone 'America/New_York')::date then
      return tt_private.error(400,'Future workouts cannot be logged yet.');
    end if;$rule$;
  planned_rule text := $rule$    if log_date>(current_timestamp at time zone 'America/New_York')::date and (
      coalesce((p_payload->>'completed')::boolean,false)
      or exists(select 1 from jsonb_each(p_payload->'entries') e
        where coalesce((e.value->>'done')::boolean,false))
    ) then
      return tt_private.error(400,'Future workouts can be planned, but cannot be checked off yet.');
    end if;$rule$;
begin
  if strpos(definition,previous_rule)=0 then
    raise exception 'The future-workout rule has changed. Review it before applying this migration.';
  end if;
  execute replace(definition,previous_rule,planned_rule);
end;
$migration$;
