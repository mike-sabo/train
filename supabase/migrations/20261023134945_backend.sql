-- Only the Edge Function's service role can call the API. Browser roles have no
-- access to these tables or functions, including when a session is revoked.
create schema tt_private;
revoke all on schema tt_private from public, anon, authenticated;

create table tt_private.members (
  id integer generated always as identity primary key,
  name text not null,
  email text not null unique,
  role text not null check (role in ('owner','member')),
  joined bigint,
  removed_at bigint,
  access_version integer not null default 0,
  theme text not null default 'ember-sky',
  login_request text
);
create unique index single_owner on tt_private.members (role) where role='owner';
create table tt_private.sessions (
  token text primary key,
  member_id integer not null references tt_private.members(id),
  expires bigint not null
);
create table tt_private.challenges (
  email text primary key,
  code_hash text not null,
  expires bigint not null,
  attempts integer not null default 0
);
create table tt_private.limits (key text primary key, count integer not null, expires bigint not null);
create table tt_private.plans (key text primary key, body jsonb not null);
create table tt_private.blocks (
  id integer generated always as identity primary key,
  plan_key text not null references tt_private.plans(key),
  start date not null,
  "end" date not null,
  weeks integer not null check (weeks between 1 and 52)
);
create table tt_private.logs (
  member_id integer not null references tt_private.members(id),
  date date not null,
  block_id integer not null references tt_private.blocks(id),
  day_id text not null,
  body jsonb not null,
  completed integer not null check (completed in (0,1)),
  revision integer not null default 1,
  primary key(member_id,date)
);
alter table tt_private.members enable row level security;
alter table tt_private.sessions enable row level security;
alter table tt_private.challenges enable row level security;
alter table tt_private.limits enable row level security;
alter table tt_private.plans enable row level security;
alter table tt_private.blocks enable row level security;
alter table tt_private.logs enable row level security;
revoke all on all tables in schema tt_private from public, anon, authenticated;
revoke all on all sequences in schema tt_private from public, anon, authenticated;

create function tt_private.reply(status integer, data jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('status',status,'data',data);
$$;
create function tt_private.error(status integer, message text) returns jsonb
language sql immutable set search_path='' as $$
  select tt_private.reply(status,jsonb_build_object('error',message));
$$;
create function tt_private.allow_attempt(k text, maximum integer, duration bigint, now_ms bigint)
returns boolean language plpgsql set search_path='' as $$
declare n integer;
begin
  insert into tt_private.limits as l values (k,1,now_ms+duration)
  on conflict(key) do update set count=l.count+1
  returning count into n;
  return n <= maximum;
end;
$$;

-- Each call is a transaction. A shared lock serializes this small group's
-- writes so concurrent devices cannot overwrite revisions or bypass limits.
-- Expected errors return values instead of exceptions so failed attempts commit.
create function public.tt_rpc(p_action text, p_payload jsonb default '{}', p_session text default '', p_ip text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  now_ms bigint := floor(extract(epoch from clock_timestamp())*1000);
  m tt_private.members%rowtype;
  other tt_private.members%rowtype;
  challenge tt_private.challenges%rowtype;
  b tt_private.blocks%rowtype;
  plan jsonb;
  day jsonb;
  exercise jsonb;
  variant jsonb;
  entry record;
  old_revision integer;
  revision integer;
  start_date date;
  end_date date;
  log_date date;
  rows jsonb;
  members jsonb;
  plans jsonb;
  blocks jsonb;
begin
  perform pg_advisory_xact_lock(27417017);
  delete from tt_private.limits where expires <= now_ms;
  delete from tt_private.sessions where expires <= now_ms;
  delete from tt_private.challenges where expires <= now_ms;

  if p_action='bootstrap' then
    select * into m from tt_private.members where role='owner';
    if found and m.email <> p_payload->>'email' then
      return tt_private.error(503,'The configured admin does not match the database.');
    end if;
    if not found then
      if exists(select 1 from tt_private.members where email=p_payload->>'email') then
        return tt_private.error(503,'A member cannot be promoted by changing configuration.');
      end if;
      insert into tt_private.members(name,email,role) values ('Mike',p_payload->>'email','owner');
    end if;
    return tt_private.reply(200,'{"ok":true}');
  end if;

  if p_action='status' then
    return tt_private.reply(200,jsonb_build_object('emailMode','resend','setup',false,
      'today',to_char(current_timestamp at time zone 'America/New_York','YYYY-MM-DD')));
  end if;

  if p_action='auth_send_prepare' then
    if not tt_private.allow_attempt('send-ip:'||p_ip,15,3600000,now_ms)
      or not tt_private.allow_attempt('send:'||(p_payload->>'email'),3,600000,now_ms) then
      return tt_private.error(429,'Too many attempts. Please wait before trying again.');
    end if;
    select * into m from tt_private.members where email=p_payload->>'email' and removed_at is null;
    if not found then return tt_private.reply(200,'{"send":false}'); end if;
    if not tt_private.allow_attempt('email-budget:'||to_char(current_timestamp at time zone 'UTC','YYYY-MM-DD'),90,86400000,now_ms) then
      return tt_private.error(429,'The daily email limit has been reached. Please try tomorrow.');
    end if;
    update tt_private.members set login_request=p_payload->>'request' where id=m.id;
    return tt_private.reply(200,jsonb_build_object('send',true,'accessVersion',m.access_version));
  end if;

  if p_action='auth_send_commit' then
    if exists(select 1 from tt_private.members where email=p_payload->>'email' and removed_at is null
      and access_version=(p_payload->>'accessVersion')::integer and login_request=p_payload->>'request') then
      insert into tt_private.challenges(email,code_hash,expires) values(p_payload->>'email',p_payload->>'codeHash',now_ms+600000)
      on conflict(email) do update set code_hash=excluded.code_hash,expires=excluded.expires,attempts=0;
    end if;
    return tt_private.reply(200,'{"ok":true}');
  end if;

  if p_action='auth_verify' then
    if not tt_private.allow_attempt('verify-ip:'||p_ip,30,600000,now_ms)
      or not tt_private.allow_attempt('verify:'||(p_payload->>'email'),10,600000,now_ms) then
      return tt_private.error(429,'Too many attempts. Please wait before trying again.');
    end if;
    select * into m from tt_private.members where email=p_payload->>'email' and removed_at is null;
    if not found then return tt_private.error(400,'Invalid or expired code.'); end if;
    select * into challenge from tt_private.challenges where email=m.email;
    if not found then return tt_private.error(400,'Invalid or expired code.'); end if;
    update tt_private.challenges set attempts=attempts+1 where email=m.email;
    if challenge.attempts >= 5 or challenge.code_hash <> p_payload->>'codeHash' then
      return tt_private.error(400,'Invalid or expired code.');
    end if;
    delete from tt_private.challenges where email=m.email;
    delete from tt_private.sessions where token=p_session;
    update tt_private.members set joined=coalesce(joined,now_ms) where id=m.id;
    insert into tt_private.sessions(token,member_id,expires) values(p_payload->>'tokenHash',m.id,now_ms+2592000000);
    return tt_private.reply(200,'{"ok":true}');
  end if;

  select mm.* into m from tt_private.members mm join tt_private.sessions s on s.member_id=mm.id
    where s.token=p_session and s.expires>now_ms and mm.removed_at is null;
  if not found then return tt_private.error(401,'Please sign in to your account.'); end if;

  if p_action='logout' then
    delete from tt_private.sessions where token=p_session;
    return tt_private.reply(200,'{"ok":true}');
  end if;

  if p_action='state' then
    start_date := (p_payload->>'week')::date;
    end_date := start_date+6;
    select coalesce(jsonb_agg(case when m.role='owner' then
      jsonb_build_object('id',mm.id,'name',mm.name,'email',mm.email,'role',mm.role,'joined',mm.joined,'removed_at',mm.removed_at)
      else jsonb_build_object('id',mm.id,'name',mm.name,'role',mm.role,'joined',mm.joined) end order by mm.id),'[]')
      into members from tt_private.members mm where m.role='owner' or mm.removed_at is null;
    select coalesce(jsonb_agg(case when m.role='owner' or l.member_id=m.id then to_jsonb(l)
      else jsonb_build_object('member_id',l.member_id,'date',l.date,'completed',l.completed) end order by l.date,l.member_id),'[]')
      into rows from tt_private.logs l join tt_private.members mm on mm.id=l.member_id
      where l.date between start_date and end_date and (m.role='owner' or mm.removed_at is null);
    select coalesce(jsonb_agg(body order by key),'[]') into plans from tt_private.plans;
    select coalesce(jsonb_agg(to_jsonb(bb) order by bb.start),'[]') into blocks from tt_private.blocks bb;
    return tt_private.reply(200,jsonb_build_object('me',jsonb_build_object('id',m.id,'name',m.name,'role',m.role,'theme',m.theme),
      'members',members,'plans',plans,'blocks',blocks,'logs',rows));
  end if;

  if p_action='history' then
    log_date := (p_payload->>'before')::date;
    select p.body into plan from tt_private.blocks bb join tt_private.plans p on p.key=bb.plan_key
      where bb.start<=log_date and bb."end">=log_date;
    select coalesce(jsonb_agg(jsonb_build_object('date',l.date,'day_id',l.day_id,'body',l.body,'plan',p.body) order by l.date desc),'[]')
      into rows from tt_private.logs l join tt_private.blocks bb on bb.id=l.block_id join tt_private.plans p on p.key=bb.plan_key
      where l.member_id=m.id and l.date<log_date;
    return tt_private.reply(200,jsonb_build_object('plan',plan,'rows',rows));
  end if;

  if p_action='preferences' then
    update tt_private.members set theme=p_payload->>'theme' where id=m.id;
    return tt_private.reply(200,jsonb_build_object('theme',p_payload->>'theme'));
  end if;

  if p_action='log' then
    log_date := (p_payload->>'date')::date;
    if log_date>(current_timestamp at time zone 'America/New_York')::date then
      return tt_private.error(400,'Future workouts cannot be logged yet.');
    end if;
    select * into b from tt_private.blocks where start<=log_date and "end">=log_date;
    if not found then return tt_private.error(400,'No training block is scheduled for this date.'); end if;
    select body into plan from tt_private.plans where key=b.plan_key;
    select value into day from jsonb_array_elements(plan->'days') where (value->>'weekday')::integer=extract(dow from log_date);
    if day is null then return tt_private.error(400,'This is a recovery day.'); end if;
    for entry in select key,value from jsonb_each(p_payload->'entries') loop
      select value into exercise from jsonb_array_elements(day->'exercises') where value->>'id'=entry.key;
      select value into variant from jsonb_array_elements(jsonb_build_array(exercise)||coalesce(exercise->'substitutions','[]'))
        where value->>'id'=entry.value->>'variant';
      if variant is null or jsonb_array_length(entry.value->'sets')<>(variant->>'sets')::integer then
        return tt_private.error(400,'The log does not match this plan.');
      end if;
      if entry.value ? 'setLinking' and (
        jsonb_array_length(entry.value#>'{setLinking,independent}')<>jsonb_array_length(entry.value->'sets')
        or entry.value#>'{setLinking,independent,0}'<>'false'::jsonb) then
        return tt_private.error(400,'Set links must match the planned sets and start with set 1.');
      end if;
    end loop;
    if (p_payload->>'completed')::boolean and exists(select 1 from jsonb_array_elements(day->'exercises') e
      where not coalesce((p_payload->'entries'->(e->>'id')->>'done')::boolean,false)) then
      return tt_private.error(400,'Check off each exercise before completing your workout.');
    end if;
    select l.revision into old_revision from tt_private.logs l where l.member_id=m.id and l.date=log_date;
    if coalesce(old_revision,0)<>(p_payload->>'revision')::integer then
      return tt_private.error(409,'This workout changed on another device. Reload before saving again.');
    end if;
    revision := coalesce(old_revision,0)+1;
    insert into tt_private.logs values(m.id,log_date,b.id,day->>'id',p_payload->'entries',(p_payload->>'completed')::boolean::integer,revision)
      on conflict(member_id,date) do update set body=excluded.body,completed=excluded.completed,revision=excluded.revision;
    return tt_private.reply(200,jsonb_build_object('ok',true,'revision',revision));
  end if;

  if m.role<>'owner' then
    return tt_private.error(403,'Only Mike’s admin account can manage members, plans, and training blocks.');
  end if;

  if p_action='invite_prepare' then
    select * into other from tt_private.members where email=p_payload->>'email';
    if found and other.removed_at is null then return tt_private.error(409,'That email address is already invited.'); end if;
    if not tt_private.allow_attempt('email-budget:'||to_char(current_timestamp at time zone 'UTC','YYYY-MM-DD'),90,86400000,now_ms) then
      return tt_private.error(429,'The daily email limit has been reached. Please try tomorrow.');
    end if;
    return tt_private.reply(200,jsonb_build_object('accessVersion',other.access_version));
  end if;
  if p_action='invite_commit' then
    select * into other from tt_private.members where email=p_payload->>'email';
    if found then
      if other.role<>'member' or other.removed_at is null or other.access_version is distinct from (p_payload->>'accessVersion')::integer then
        return tt_private.error(409,'This invitation changed. Refresh the group before trying again.');
      end if;
      update tt_private.members set name=p_payload->>'name',removed_at=null,joined=null,access_version=access_version+1,login_request=null where id=other.id;
    else
      if p_payload->>'accessVersion' is not null then return tt_private.error(409,'This invitation changed. Refresh the group.'); end if;
      insert into tt_private.members(name,email,role) values(p_payload->>'name',p_payload->>'email','member');
    end if;
    return tt_private.reply(200,jsonb_build_object('ok',true,'message','Invitation emailed to '||(p_payload->>'name')||'.'));
  end if;

  if p_action='revoke' then
    select * into other from tt_private.members where id=(p_payload->>'id')::integer;
    if not found then return tt_private.error(404,'Member not found.'); end if;
    if other.role='owner' then return tt_private.error(403,'The admin account cannot be removed.'); end if;
    update tt_private.members set removed_at=coalesce(removed_at,now_ms),access_version=access_version+1,login_request=null where id=other.id;
    delete from tt_private.sessions where member_id=other.id;
    delete from tt_private.challenges where email=other.email;
    return tt_private.reply(200,jsonb_build_object('ok',true,'message',other.name||'’s access has been revoked. Workout history is preserved.'));
  end if;

  if p_action='plan' then
    if exists(select 1 from tt_private.plans where key=(p_payload->>'id')||'@'||(p_payload->>'version')) then
      return tt_private.error(409,'That plan version exists. Increase the version to preserve workout history.');
    end if;
    insert into tt_private.plans values((p_payload->>'id')||'@'||(p_payload->>'version'),p_payload);
    return tt_private.reply(200,'{"ok":true}');
  end if;

  if p_action='block' then
    if not exists(select 1 from tt_private.plans where key=p_payload->>'planKey') then
      return tt_private.error(400,'Choose an existing plan.');
    end if;
    start_date := (p_payload->>'start')::date;
    end_date := start_date+(p_payload->>'weeks')::integer*7-1;
    if exists(select 1 from tt_private.blocks where start<=end_date and "end">=start_date) then
      return tt_private.error(409,'This block overlaps an existing training block. Choose a later start date.');
    end if;
    insert into tt_private.blocks(plan_key,start,"end",weeks) values(p_payload->>'planKey',start_date,end_date,(p_payload->>'weeks')::integer);
    return tt_private.reply(200,'{"ok":true}');
  end if;
  return tt_private.error(404,'Not found.');
end;
$$;
revoke all on all functions in schema tt_private from public, anon, authenticated;
revoke all on function public.tt_rpc(text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.tt_rpc(text,jsonb,text,text) to service_role;
-- The server role receives access only to the app's own database objects.
-- The API runs as its caller rather than inheriting the migration owner's rights.
grant usage on schema tt_private to service_role;
grant select, insert, update, delete on all tables in schema tt_private to service_role;
grant usage on all sequences in schema tt_private to service_role;
grant execute on all functions in schema tt_private to service_role;
