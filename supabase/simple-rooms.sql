-- Additive rollout: legacy Auth, workspaces, rooms and files remain untouched.
create schema if not exists private;
create table private.cw_people (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  code_hash bytea not null unique,
  created_at timestamptz not null default now()
);
create table private.cw_sessions (
  token_hash bytea primary key,
  person_id uuid not null references private.cw_people(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '12 hours'
);
create index cw_sessions_person on private.cw_sessions(person_id);
create table private.cw_limits (
  key text primary key,
  started_at timestamptz not null default now(),
  hits integer not null default 1
);
create table private.cw_rooms (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (number ~ '^[0-9]{6}$'),
  name text not null check (char_length(name) between 2 and 80),
  owner_id uuid not null references private.cw_people(id),
  created_at timestamptz not null default now()
);
create table private.cw_members (
  room_id uuid not null references private.cw_rooms(id) on delete cascade,
  person_id uuid not null references private.cw_people(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, person_id)
);
create index cw_members_person on private.cw_members(person_id);
create table private.cw_posts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references private.cw_rooms(id) on delete cascade,
  author_id uuid not null references private.cw_people(id),
  content text not null default '' check (char_length(content) <= 100000),
  file_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index cw_posts_room_created on private.cw_posts(room_id, created_at desc);
alter table private.cw_people enable row level security;
alter table private.cw_sessions enable row level security;
alter table private.cw_limits enable row level security;
alter table private.cw_rooms enable row level security;
alter table private.cw_members enable row level security;
alter table private.cw_posts enable row level security;
revoke all on private.cw_people, private.cw_sessions, private.cw_limits,
  private.cw_rooms, private.cw_members, private.cw_posts from public, anon, authenticated;

-- Only these checked functions can access the private tables. No Supabase
-- Auth JWT is needed; a random 256-bit session identifies the supercode user.
create function private.cw_uid() returns uuid
language sql stable security definer set search_path = '' as $$
  select person_id from private.cw_sessions
  where token_hash = extensions.digest(coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-copywall-session',
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x_copywall_session', ''), 'sha256')
    and expires_at > now();
$$;
create function private.cw_throttle(p_key text, p_max integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare count_now integer;
begin
  insert into private.cw_limits(key) values(p_key)
  on conflict(key) do update set
    hits = case when cw_limits.started_at < now() - interval '15 minutes' then 1 else cw_limits.hits + 1 end,
    started_at = case when cw_limits.started_at < now() - interval '15 minutes' then now() else cw_limits.started_at end
  returning hits into count_now;
  return count_now <= p_max;
end; $$;

create function private.cw_call(p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  person uuid; code text; token text; email_input text; person_name text;
  room private.cw_rooms; post private.cw_posts; result jsonb; ip text;
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
begin
  if p_action in ('register', 'login') then
    ip := coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', 'unknown');
    if not private.cw_throttle('access-global', 1000)
      or not private.cw_throttle('access-ip:' || encode(extensions.digest(ip, 'sha256'),'hex'), 120) then
      return jsonb_build_object('error','Too many attempts. Please try again in 15 minutes.');
    end if;
    if p_action = 'register' then
      email_input := lower(trim(coalesce(p_data->>'email','')));
      if char_length(email_input) > 254 or email_input !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        return jsonb_build_object('error','Enter a valid email address.');
      end if;
      if exists(select 1 from private.cw_people where email = email_input) then
        return jsonb_build_object('error','This email already has a supercode. Use your saved code to log in.');
      end if;
      if not private.cw_throttle('register-global', 200) then
        return jsonb_build_object('error','Please try again in 15 minutes.');
      end if;
      person_name := left(split_part(email_input, '@', 1), 32);
      loop
        code := '';
        for i in 1..6 loop
          -- Rejection sampling avoids modulo bias over the 36-character alphabet.
          declare b integer; begin
            loop b := get_byte(extensions.gen_random_bytes(1),0); exit when b < 252; end loop;
            code := code || substr(alphabet, (b % 36) + 1, 1);
          end;
        end loop;
        exit when code ~ '[A-Z]' and code ~ '[0-9]' and not exists
          (select 1 from private.cw_people where code_hash = extensions.digest(code,'sha256'));
      end loop;
      insert into private.cw_people(email, name, code_hash)
      values(email_input, person_name, extensions.digest(code,'sha256')) returning id into person;
    else
      code := upper(trim(coalesce(p_data->>'code','')));
      if code !~ '^[A-Z0-9]{6}$' then
        return jsonb_build_object('error','Enter your 6-character supercode.');
      end if;
      if not private.cw_throttle('code:' || encode(extensions.digest(code,'sha256'),'hex'), 20) then
        return jsonb_build_object('error','Too many attempts for this code. Try again in 15 minutes.');
      end if;
      select id, name into person, person_name from private.cw_people where code_hash = extensions.digest(code,'sha256');
      if person is null then return jsonb_build_object('error','Supercode not found. Check the code and try again.'); end if;
    end if;
    token := encode(extensions.gen_random_bytes(32),'hex');
    delete from private.cw_sessions where person_id = person and expires_at < now();
    insert into private.cw_sessions(token_hash,person_id) values(extensions.digest(token,'sha256'),person);
    return jsonb_build_object('id',person,'name',person_name,'token',token,
      'supercode',case when p_action = 'register' then code else null end);
  end if;

  person := private.cw_uid();
  if person is null then return jsonb_build_object('error','Your session ended. Enter your supercode again.','unauthorized',true); end if;
  if p_action = 'logout' then
    delete from private.cw_sessions where token_hash = extensions.digest(
      nullif(current_setting('request.headers',true),'')::jsonb->>'x-copywall-session','sha256');
    return jsonb_build_object('ok',true);
  end if;
  if p_action = 'me' then
    select jsonb_build_object('id',id,'name',name) into result from private.cw_people where id = person;
    return result;
  end if;
  if p_action = 'rooms' then
    select coalesce(jsonb_agg(to_jsonb(r) order by m.joined_at desc),'[]') into result
    from private.cw_rooms r join private.cw_members m on m.room_id=r.id where m.person_id=person;
    return jsonb_build_object('rooms',result);
  end if;
  if p_action in ('create_room','join_room','post','delete_post') and not private.cw_throttle('write:'||person::text,120) then
    return jsonb_build_object('error','You’re going too fast. Try again in 15 minutes.');
  end if;
  if p_action = 'create_room' then
    if char_length(trim(coalesce(p_data->>'name',''))) not between 2 and 80 then
      return jsonb_build_object('error','Give your room a name between 2 and 80 characters.');
    end if;
    if (select count(*) from private.cw_rooms where owner_id=person) >= 20 then
      return jsonb_build_object('error','You can create up to 20 rooms.');
    end if;
    loop
      code := lpad(((('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint % 900000)+100000)::text,6,'0');
      begin
        insert into private.cw_rooms(number,name,owner_id) values(code,trim(p_data->>'name'),person) returning * into room;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
    insert into private.cw_members(room_id,person_id) values(room.id,person);
    return jsonb_build_object('room',to_jsonb(room));
  end if;
  if p_action = 'join_room' then
    select * into room from private.cw_rooms where number=trim(p_data->>'number');
    if room.id is null then return jsonb_build_object('error','Room not found. Check the 6-digit room number.'); end if;
    insert into private.cw_members(room_id,person_id) values(room.id,person) on conflict do nothing;
    return jsonb_build_object('room',to_jsonb(room));
  end if;
  select r.* into room from private.cw_rooms r join private.cw_members m on m.room_id=r.id
    where r.id::text=p_data->>'room_id' and m.person_id=person;
  if room.id is null then return jsonb_build_object('error','Join this room first.'); end if;
  if p_action = 'wall' then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]') into result from (
      select c.*,u.name as author_name from private.cw_posts c join private.cw_people u on u.id=c.author_id
      where c.room_id=room.id and c.expires_at>now() order by c.created_at desc limit 200
    ) p;
    return jsonb_build_object('posts',result,'members',(select count(*) from private.cw_members where room_id=room.id));
  end if;
  if p_action = 'post' then
    if char_length(coalesce(p_data->>'content',''))>100000 then return jsonb_build_object('error','Text is limited to 100,000 characters.'); end if;
    if coalesce(trim(p_data->>'content'),'')='' and coalesce(p_data->>'file_path','')='' then
      return jsonb_build_object('error','Paste something or attach a file.');
    end if;
    if p_data->>'file_path' is not null and (
      split_part(p_data->>'file_path','/',1)<>room.id::text or split_part(p_data->>'file_path','/',2)<>person::text
      or not exists(select 1 from storage.objects where bucket_id='simple-wall-files' and name=p_data->>'file_path')
    ) then return jsonb_build_object('error','Upload the file to this room first.'); end if;
    insert into private.cw_posts(room_id,author_id,content,file_path,file_name,file_size,mime_type)
      values(room.id,person,coalesce(p_data->>'content',''),p_data->>'file_path',left(p_data->>'file_name',120),
        (p_data->>'file_size')::bigint,left(p_data->>'mime_type',120));
    return jsonb_build_object('ok',true);
  end if;
  if p_action = 'delete_post' then
    select * into post from private.cw_posts where id::text=p_data->>'post_id' and room_id=room.id;
    if post.author_id<>person and room.owner_id<>person or post.id is null then
      return jsonb_build_object('error','Only the author or room creator can remove this post.');
    end if;
    delete from private.cw_posts where id=post.id;
    return jsonb_build_object('ok',true);
  end if;
  return jsonb_build_object('error','Unknown action.');
end; $$;

-- Public API wrapper uses invoker privileges; the internal implementation is
-- deliberately privileged because it implements custom session authorization.
create function public.cw_call(p_action text, p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path = '' as $$ select private.cw_call(p_action,p_data); $$;
create function private.cw_file_allowed(p_path text, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.cw_members m
    where m.person_id=private.cw_uid() and m.room_id::text=split_part(p_path,'/',1)
      and (not p_write or m.person_id::text=split_part(p_path,'/',2)));
$$;
revoke all on function private.cw_uid(),private.cw_throttle(text,integer),private.cw_call(text,jsonb),
  public.cw_call(text,jsonb),private.cw_file_allowed(text,boolean) from public;
grant usage on schema private to anon,authenticated;
grant execute on function public.cw_call(text,jsonb),private.cw_call(text,jsonb),private.cw_file_allowed(text,boolean) to anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
values('simple-wall-files','simple-wall-files',false,52428800);
create policy cw_files_read on storage.objects for select to anon,authenticated
using(bucket_id='simple-wall-files' and private.cw_file_allowed(name,false));
create policy cw_files_upload on storage.objects for insert to anon,authenticated
with check(bucket_id='simple-wall-files' and private.cw_file_allowed(name,true));
create policy cw_files_remove on storage.objects for delete to anon,authenticated
using(bucket_id='simple-wall-files' and private.cw_file_allowed(name,true));
