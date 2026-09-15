-- Compatibility restoration for app commit 3a1f843.
-- Preserves newer room data but makes it inaccessible to browser roles while
-- the original shared wall is active. The legacy password is NOT server auth.
-- Restore the room policies/bucket privacy before re-enabling private rooms.

alter table public.clips enable row level security;
grant select, insert, update, delete on public.clips to anon, authenticated;

-- Keep the private-room trigger for room inserts, not legacy shared posts.
drop trigger if exists on_clip_created on public.clips;
create trigger on_clip_created before insert on public.clips
for each row when (new.room_id is not null)
execute function private.set_clip_expiry();

drop policy if exists legacy_wall_only on public.clips;
create policy legacy_wall_only on public.clips as restrictive
for all to anon, authenticated
using (room_id is null and author_id is null)
with check (room_id is null and author_id is null);

drop policy if exists legacy_wall_read on public.clips;
create policy legacy_wall_read on public.clips for select to anon, authenticated
using (room_id is null and author_id is null);
drop policy if exists legacy_wall_insert on public.clips;
create policy legacy_wall_insert on public.clips for insert to anon, authenticated
with check (room_id is null and author_id is null);
drop policy if exists legacy_wall_update on public.clips;
create policy legacy_wall_update on public.clips for update to anon, authenticated
using (room_id is null and author_id is null)
with check (room_id is null and author_id is null);
drop policy if exists legacy_wall_delete on public.clips;
create policy legacy_wall_delete on public.clips for delete to anon, authenticated
using (room_id is null and author_id is null);

-- Do not expose any existing private-room uploads. Abort rather than leak.
do $$ begin
  if exists (select 1 from storage.objects where bucket_id = 'wall-files'
    and split_part(name, '/', 1) not in ('Prakhar','Arhem','Nipun','Gokul')) then
    raise exception 'Private files exist in wall-files; archive them safely before restoring public downloads';
  end if;
end $$;

-- Disallow uploads using the newer private-room UUID paths in the public bucket.
drop policy if exists legacy_wall_files_only on storage.objects;
create policy legacy_wall_files_only on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'wall-files' or split_part(name,'/',1) in ('Prakhar','Arhem','Nipun','Gokul'))
with check (bucket_id <> 'wall-files' or split_part(name,'/',1) in ('Prakhar','Arhem','Nipun','Gokul'));

drop policy if exists legacy_wall_files_read on storage.objects;
create policy legacy_wall_files_read on storage.objects for select to anon, authenticated
using (bucket_id = 'wall-files' and split_part(name,'/',1) in ('Prakhar','Arhem','Nipun','Gokul'));
drop policy if exists legacy_wall_files_insert on storage.objects;
create policy legacy_wall_files_insert on storage.objects for insert to anon, authenticated
with check (bucket_id = 'wall-files' and split_part(name,'/',1) in ('Prakhar','Arhem','Nipun','Gokul'));
drop policy if exists legacy_wall_files_delete on storage.objects;
create policy legacy_wall_files_delete on storage.objects for delete to anon, authenticated
using (bucket_id = 'wall-files' and split_part(name,'/',1) in ('Prakhar','Arhem','Nipun','Gokul'));

insert into storage.buckets (id, name, public, file_size_limit)
values ('wall-files','wall-files',true,52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='clips') then
    alter publication supabase_realtime add table public.clips;
  end if;
end $$;
notify pgrst, 'reload schema';
