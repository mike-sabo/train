-- Run once after adding Foundation version 5. This updates the existing block
-- requested on October 26 without changing earlier plan versions or recorded sets.
DO $activation$
DECLARE
  target tt_private.blocks%ROWTYPE;
  previous_plan jsonb;
  next_plan jsonb;
  expected_plan jsonb;
  saved record;
  entry record;
  variant jsonb;
  updated_entry jsonb;
  updated_body jsonb;
  added_sets boolean;
BEGIN
  -- Use the API's lock so a workout cannot save halfway through the change.
  PERFORM pg_advisory_xact_lock(27417017);
  SELECT * INTO STRICT target FROM tt_private.blocks
    WHERE start=DATE '2026-10-26' AND "end"=DATE '2026-12-20'
    FOR UPDATE;
  IF target.plan_key='three-day-foundation@5' THEN
    RETURN;
  END IF;
  IF target.plan_key<>'three-day-foundation@4' THEN
    RAISE EXCEPTION 'The training block has changed. Review its plan before upgrading.';
  END IF;
  IF EXISTS(SELECT 1 FROM tt_private.logs WHERE block_id=target.id AND date<DATE '2026-10-26') THEN
    RAISE EXCEPTION 'Earlier workout history must be preserved before upgrading this block.';
  END IF;
  SELECT body INTO STRICT previous_plan FROM tt_private.plans WHERE key=target.plan_key;
  SELECT body INTO STRICT next_plan FROM tt_private.plans WHERE key='three-day-foundation@5';
  SELECT previous_plan || jsonb_build_object(
    'version',5,
    'description','Eight weeks of training together, with three sets for every exercise and substitution.',
    'days',jsonb_agg(day.value || jsonb_build_object('exercises',(
      SELECT jsonb_agg(exercise.value || jsonb_build_object('sets',3,'substitutions',(
        SELECT coalesce(jsonb_agg(substitution.value || '{"sets":3}'::jsonb ORDER BY substitution.position),'[]'::jsonb)
        FROM jsonb_array_elements(exercise.value->'substitutions') WITH ORDINALITY substitution(value,position)
      )) ORDER BY exercise.position)
      FROM jsonb_array_elements(day.value->'exercises') WITH ORDINALITY exercise(value,position)
    )) ORDER BY day.position)
  ) INTO expected_plan
  FROM jsonb_array_elements(previous_plan->'days') WITH ORDINALITY day(value,position);
  IF expected_plan<>next_plan THEN
    RAISE EXCEPTION 'Version 5 must preserve the existing exercises, rep ranges, and demonstrations.';
  END IF;
  FOR saved IN SELECT * FROM tt_private.logs WHERE block_id=target.id FOR UPDATE LOOP
    updated_body := saved.body;
    added_sets := false;
    FOR entry IN SELECT * FROM jsonb_each(saved.body) LOOP
      SELECT choice INTO variant
      FROM jsonb_array_elements(previous_plan->'days') day,
        LATERAL jsonb_array_elements(day->'exercises') exercise,
        LATERAL jsonb_array_elements(jsonb_build_array(exercise)||(exercise->'substitutions')) choice
      WHERE day->>'id'=saved.day_id AND exercise->>'id'=entry.key
        AND choice->>'id'=entry.value->>'variant';
      IF variant IS NULL OR jsonb_array_length(entry.value->'sets')<>(variant->>'sets')::integer THEN
        RAISE EXCEPTION 'A saved exercise does not match the previous plan. Review it before upgrading.';
      END IF;
      updated_entry := entry.value;
      WHILE jsonb_array_length(updated_entry->'sets')<3 LOOP
        updated_entry := jsonb_set(updated_entry,'{sets}',
          (updated_entry->'sets') || '[{"weight":null,"reps":null}]'::jsonb);
        IF updated_entry ? 'setLinking' THEN
          updated_entry := jsonb_set(updated_entry,'{setLinking,independent}',
            (updated_entry#>'{setLinking,independent}') || 'false'::jsonb);
        END IF;
        updated_entry := jsonb_set(updated_entry,'{done}','false'::jsonb);
        added_sets := true;
      END LOOP;
      updated_body := jsonb_set(updated_body,ARRAY[entry.key],updated_entry);
    END LOOP;
    -- Blank new rows are not completed sets. A new revision also rejects stale saves.
    UPDATE tt_private.logs SET body=updated_body,
      completed=CASE WHEN added_sets THEN 0 ELSE saved.completed END,
      revision=saved.revision+1
    WHERE member_id=saved.member_id AND date=saved.date;
  END LOOP;
  UPDATE tt_private.blocks SET plan_key='three-day-foundation@5' WHERE id=target.id;
END;
$activation$;
