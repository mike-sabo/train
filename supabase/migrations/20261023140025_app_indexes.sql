-- These indexes support member revocation and foreign-key checks without
-- scanning every session, training block, or workout log as the group grows.
create index sessions_member_id_idx on tt_private.sessions(member_id);
create index blocks_plan_key_idx on tt_private.blocks(plan_key);
create index logs_block_id_idx on tt_private.logs(block_id);
