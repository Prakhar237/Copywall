-- Copywall multi-workspace schema
-- Run this once in Supabase SQL Editor before deploying this version.
-- It replaces the old public "clips" policies with private, account-based access.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 48),
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  retention_hours integer not null default 24 check (retention_hours between 1 and 720),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{10}$'),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  max_uses integer not null default 100 check (max_uses between 1 and 1000),
  use_count integer not null default 0 check (use_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Upgrade the original single-wall table in place. Old posts deliberately have
-- no room and are no longer visible once the private-room policies are enabled.
alter table public.clips add column if not exists room_id uuid references public.rooms (id) on delete cascade;
alter table public.clips add column if not exists author_id uuid references auth.users (id) on delete set null;
alter table public.clips add column if not exists expires_at timestamptz;
alter table public.clips alter column content set default '';
create index if not exists clips_room_created_at_idx on public.clips (room_id, created_at desc);
create index if not exists clips_expires_at_idx on public.clips (expires_at);
create index if not exists rooms_workspace_idx on public.rooms (workspace_id);
create index if not exists workspace_members_user_idx on public.workspace_members (user_id);
create index if not exists workspace_invites_code_idx on public.workspace_invites (code);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  candidate_name text;
begin
  candidate_name := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(new.email, '@', 1), ''), 'Copywaller'), 48);
  if char_length(candidate_name) < 2 then
    candidate_name := 'Copywaller';
  end if;
  insert into public.profiles (id, display_name)
  values (new.id, candidate_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.handle_workspace_created()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute procedure public.handle_workspace_created();

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.rooms
    where id = p_room_id and public.is_workspace_member(workspace_id)
  );
$$;

create or replace function public.is_room_member_by_file_path(p_name text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  room_part text;
begin
  room_part := split_part(p_name, '/', 1);
  if room_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_room_member(room_part::uuid);
end;
$$;

create or replace function public.set_clip_expiry()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  room_retention integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before posting';
  end if;
  select retention_hours into room_retention from public.rooms where id = new.room_id;
  if room_retention is null then
    raise exception 'Room does not exist';
  end if;
  new.author_id := auth.uid();
  select display_name into new.author_name from public.profiles where id = auth.uid();
  if new.author_name is null then
    raise exception 'Profile does not exist';
  end if;
  new.created_at := now();
  new.expires_at := now() + make_interval(hours => room_retention);
  return new;
end;
$$;

drop trigger if exists on_clip_created on public.clips;
create trigger on_clip_created
  before insert on public.clips
  for each row execute procedure public.set_clip_expiry();

create or replace function public.protect_clip_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.room_id is distinct from old.room_id
    or new.author_id is distinct from old.author_id
    or new.author_name is distinct from old.author_name
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
    or new.file_path is distinct from old.file_path
    or new.file_name is distinct from old.file_name
    or new.file_size is distinct from old.file_size
    or new.mime_type is distinct from old.mime_type then
    raise exception 'Only a clip’s text can be edited';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_clip_fields on public.clips;
create trigger protect_clip_fields
  before update on public.clips
  for each row execute procedure public.protect_clip_fields();

create or replace function public.create_workspace_invite(
  p_workspace_id uuid,
  p_expires_in_hours integer default 168
)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_code text;
  invite_expiry timestamptz;
begin
  if auth.uid() is null or not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Only a workspace owner can make an invite';
  end if;
  if p_expires_in_hours not between 1 and 720 then
    raise exception 'Invite expiry must be between 1 and 720 hours';
  end if;
  invite_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));
  invite_expiry := now() + make_interval(hours => p_expires_in_hours);
  insert into public.workspace_invites (workspace_id, code, created_by, expires_at)
  values (p_workspace_id, invite_code, auth.uid(), invite_expiry);
  return query select invite_code, invite_expiry;
end;
$$;

-- Workspace creation is intentionally routed through this narrow RPC. It only
-- accepts a name and always assigns the authenticated caller as the owner,
-- avoiding a browser-side insert that can be rejected by RLS during signup.
create or replace function public.create_workspace(p_name text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace public.workspaces;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before creating a workspace';
  end if;
  if char_length(trim(p_name)) not between 2 and 80 then
    raise exception 'Workspace name must be between 2 and 80 characters';
  end if;

  insert into public.workspaces (name, owner_id)
  values (trim(p_name), (select auth.uid()))
  returning * into new_workspace;

  return new_workspace;
end;
$$;

create or replace function public.join_workspace_with_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.workspace_invites%rowtype;
  rows_added integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before joining a workspace';
  end if;
  select * into invite
  from public.workspace_invites
  where code = upper(trim(p_code))
    and revoked_at is null
    and expires_at > now()
    and use_count < max_uses
  for update;
  if not found then
    raise exception 'This invite is invalid, full, or expired';
  end if;

  insert into public.workspace_members (workspace_id, user_id)
  values (invite.workspace_id, auth.uid())
  on conflict (workspace_id, user_id) do nothing;
  get diagnostics rows_added = row_count;
  if rows_added > 0 then
    update public.workspace_invites set use_count = use_count + 1 where id = invite.id;
  end if;
  return invite.workspace_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.rooms enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.clips enable row level security;

-- Remove the original public policies and make this script safe to rerun.
do $$
declare
  current_policy record;
begin
  for current_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'workspaces', 'workspace_members', 'rooms', 'workspace_invites', 'clips')
  loop
    execute format('drop policy if exists %I on %I.%I', current_policy.policyname, current_policy.schemaname, current_policy.tablename);
  end loop;
end $$;

create policy profiles_read_workspace_peers on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  ));
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy workspaces_read_members on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy workspaces_create_owner on public.workspaces for insert to authenticated with check (owner_id = auth.uid());
create policy workspaces_update_owner on public.workspaces for update to authenticated using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));
create policy workspaces_delete_owner on public.workspaces for delete to authenticated using (public.is_workspace_admin(id));

create policy workspace_members_read_members on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));

create policy rooms_read_members on public.rooms for select to authenticated using (public.is_workspace_member(workspace_id));
create policy rooms_create_members on public.rooms for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy rooms_update_creator_or_owner on public.rooms for update to authenticated using (created_by = auth.uid() or public.is_workspace_admin(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy rooms_delete_creator_or_owner on public.rooms for delete to authenticated using (created_by = auth.uid() or public.is_workspace_admin(workspace_id));

create policy invites_read_owners on public.workspace_invites for select to authenticated using (public.is_workspace_admin(workspace_id));

create policy clips_read_room_members on public.clips for select to authenticated using (public.is_room_member(room_id) and expires_at > now());
create policy clips_create_room_members on public.clips for insert to authenticated with check (public.is_room_member(room_id) and author_id = auth.uid());
create policy clips_update_author on public.clips for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid() and public.is_room_member(room_id));
create policy clips_delete_author_or_owner on public.clips for delete to authenticated using (
  author_id = auth.uid() or exists (
    select 1 from public.rooms where rooms.id = clips.room_id and public.is_workspace_admin(rooms.workspace_id)
  )
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.workspaces, public.workspace_members, public.rooms, public.workspace_invites, public.clips to authenticated;
grant execute on function public.create_workspace_invite(uuid, integer), public.join_workspace_with_invite(text) to authenticated;

insert into storage.buckets (id, name, public)
values ('wall-files', 'wall-files', false)
on conflict (id) do update set public = false;

do $$
declare
  current_policy record;
begin
  for current_policy in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like 'Copywall %' or qual like '%wall-files%' or with_check like '%wall-files%')
  loop
    execute format('drop policy if exists %I on storage.objects', current_policy.policyname);
  end loop;
end $$;

create policy "Copywall room members read files" on storage.objects for select to authenticated
  using (bucket_id = 'wall-files' and public.is_room_member_by_file_path(name));
create policy "Copywall room members upload files" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'wall-files'
    and public.is_room_member_by_file_path(name)
    and split_part(name, '/', 2) = auth.uid()::text
  );
create policy "Copywall file owners delete files" on storage.objects for delete to authenticated
  using (bucket_id = 'wall-files' and owner_id = auth.uid()::text);

-- Keep implementation helpers out of the Data API's exposed public schema.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

alter function public.handle_new_user() set schema private;
alter function public.handle_workspace_created() set schema private;
alter function public.is_workspace_member(uuid) set schema private;
alter function public.is_workspace_admin(uuid) set schema private;
alter function public.is_room_member(uuid) set schema private;
alter function public.is_room_member_by_file_path(text) set schema private;
alter function public.set_clip_expiry() set schema private;
alter function public.protect_clip_fields() set schema private;

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = (select auth.uid())
  );
$$;

create or replace function private.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

create or replace function private.is_room_member(p_room_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1 from public.rooms
    where id = p_room_id and private.is_workspace_member(workspace_id)
  );
$$;

create or replace function private.is_room_member_by_file_path(p_name text)
returns boolean
language plpgsql
security definer
stable
set search_path = public, private
as $$
declare
  room_part text;
begin
  room_part := split_part(p_name, '/', 1);
  if room_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_room_member(room_part::uuid);
end;
$$;

create or replace function public.create_workspace_invite(
  p_workspace_id uuid,
  p_expires_in_hours integer default 168
)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  invite_code text;
  invite_expiry timestamptz;
begin
  if auth.uid() is null or not private.is_workspace_admin(p_workspace_id) then
    raise exception 'Only a workspace owner can make an invite';
  end if;
  if p_expires_in_hours not between 1 and 720 then
    raise exception 'Invite expiry must be between 1 and 720 hours';
  end if;
  invite_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));
  invite_expiry := now() + make_interval(hours => p_expires_in_hours);
  insert into public.workspace_invites (workspace_id, code, created_by, expires_at)
  values (p_workspace_id, invite_code, auth.uid(), invite_expiry);
  return query select invite_code, invite_expiry;
end;
$$;

drop policy if exists workspaces_read_members on public.workspaces;
drop policy if exists workspaces_update_owner on public.workspaces;
drop policy if exists workspaces_delete_owner on public.workspaces;
drop policy if exists workspace_members_read_members on public.workspace_members;
drop policy if exists rooms_read_members on public.rooms;
drop policy if exists rooms_create_members on public.rooms;
drop policy if exists rooms_update_creator_or_owner on public.rooms;
drop policy if exists rooms_delete_creator_or_owner on public.rooms;
drop policy if exists invites_read_owners on public.workspace_invites;
drop policy if exists clips_read_room_members on public.clips;
drop policy if exists clips_create_room_members on public.clips;
drop policy if exists clips_update_author on public.clips;
drop policy if exists clips_delete_author_or_owner on public.clips;
create policy workspaces_read_members on public.workspaces for select to authenticated using (private.is_workspace_member(id));
create policy workspaces_update_owner on public.workspaces for update to authenticated using (private.is_workspace_admin(id)) with check (private.is_workspace_admin(id));
create policy workspaces_delete_owner on public.workspaces for delete to authenticated using (private.is_workspace_admin(id));
create policy workspace_members_read_members on public.workspace_members for select to authenticated using (private.is_workspace_member(workspace_id));
create policy rooms_read_members on public.rooms for select to authenticated using (private.is_workspace_member(workspace_id));
create policy rooms_create_members on public.rooms for insert to authenticated with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
create policy rooms_update_creator_or_owner on public.rooms for update to authenticated using (created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy rooms_delete_creator_or_owner on public.rooms for delete to authenticated using (created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id));
create policy invites_read_owners on public.workspace_invites for select to authenticated using (private.is_workspace_admin(workspace_id));
create policy clips_read_room_members on public.clips for select to authenticated using (private.is_room_member(room_id) and expires_at > now());
create policy clips_create_room_members on public.clips for insert to authenticated with check (private.is_room_member(room_id) and author_id = (select auth.uid()));
create policy clips_update_author on public.clips for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()) and private.is_room_member(room_id));
create policy clips_delete_author_or_owner on public.clips for delete to authenticated using (author_id = (select auth.uid()) or exists (select 1 from public.rooms where rooms.id = clips.room_id and private.is_workspace_admin(rooms.workspace_id)));

drop policy if exists "Copywall room members read files" on storage.objects;
drop policy if exists "Copywall room members upload files" on storage.objects;
create policy "Copywall room members read files" on storage.objects for select to authenticated
  using (bucket_id = 'wall-files' and private.is_room_member_by_file_path(name));
create policy "Copywall room members upload files" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'wall-files'
    and private.is_room_member_by_file_path(name)
    and split_part(name, '/', 2) = (select auth.uid())::text
  );

grant execute on function private.is_workspace_member(uuid), private.is_workspace_admin(uuid), private.is_room_member(uuid), private.is_room_member_by_file_path(text) to authenticated;
revoke all on function public.create_workspace(text), public.create_workspace_invite(uuid, integer), public.join_workspace_with_invite(text) from public, anon;
grant execute on function public.create_workspace(text), public.create_workspace_invite(uuid, integer), public.join_workspace_with_invite(text) to authenticated;

-- In the Supabase dashboard, enable Realtime replication for public.clips.
