-- Rollback-only checks; no fixture posts remain.
begin;
set local role anon;
do $$
declare fixture uuid; changed integer;
begin
  assert not exists (select 1 from public.clips where room_id is not null), 'Private posts must stay hidden';
  insert into public.clips(author_name,content) values ('Prakhar','Rollback compatibility test') returning id into fixture;
  assert exists (select 1 from public.clips where id=fixture), 'Anonymous client can read a shared post';
  update public.clips set content='Edited rollback test' where id=fixture and author_name='Prakhar';
  get diagnostics changed = row_count;
  assert changed=1, 'Legacy edit must work';
  assert exists (select 1 from public.clips where id=fixture and content='Edited rollback test'), 'Edit persists';
  delete from public.clips where id=fixture;
  get diagnostics changed = row_count;
  assert changed=1, 'Legacy deletion must work';
end $$;
reset role;
set local role authenticated;
do $$ begin
  assert not exists (select 1 from public.clips where room_id is not null), 'Stale signed-in sessions must not see private posts in old UI';
end $$;
rollback;
