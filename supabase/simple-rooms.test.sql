-- Run after simple-rooms.sql. All fixtures and limits roll back.
begin;
set local role anon;
do $$
declare
  a jsonb; b jsonb; login_result jsonb; room jsonb; result jsonb; posted jsonb;
  suffix text := gen_random_uuid()::text;
begin
  perform set_config('request.headers','{}',true);
  result := public.cw_call('me');
  assert result->>'unauthorized'='true', 'Missing sessions must fail';
  a := public.cw_call('register',jsonb_build_object('email','cw-test-a-'||suffix||'@example.invalid'));
  assert a->>'supercode' ~ '^[A-Z0-9]{6}$', 'Issue exactly six characters';
  assert a->>'supercode' ~ '[A-Z]' and a->>'supercode' ~ '[0-9]', 'Code contains a letter and digit';
  result := public.cw_call('register',jsonb_build_object('email','cw-test-a-'||suffix||'@example.invalid'));
  assert result ? 'error' and not result ? 'supercode', 'Email alone cannot recover or reveal a code';
  login_result := public.cw_call('login',jsonb_build_object('code',lower(a->>'supercode')));
  assert login_result->>'id'=a->>'id' and login_result->>'token'<>a->>'token', 'Cross-device login has a new session for the same person';
  perform set_config('request.headers',jsonb_build_object('x-copywall-session',a->>'token')::text,true);
  room := public.cw_call('create_room','{"name":"Test room"}') -> 'room';
  assert room->>'number' ~ '^[0-9]{6}$', 'Six-digit room number';
  result := public.cw_call('post',jsonb_build_object('room_id',room->>'id','content','hello from A'));
  assert result->>'ok'='true','Member can post';
  result := public.cw_call('wall',jsonb_build_object('room_id',room->>'id'));
  assert jsonb_array_length(result->'posts')=1,'Member can read wall';
  posted := result->'posts'->0;
  assert private.cw_file_allowed((room->>'id')||'/'||(a->>'id')||'/test.txt',true),'Uploader path allowed';

  perform set_config('request.headers','{}',true);
  b := public.cw_call('register',jsonb_build_object('email','cw-test-b-'||suffix||'@example.invalid'));
  perform set_config('request.headers',jsonb_build_object('x-copywall-session',b->>'token')::text,true);
  result := public.cw_call('wall',jsonb_build_object('room_id',room->>'id'));
  assert result ? 'error','Outsider cannot read by room UUID';
  assert not private.cw_file_allowed((room->>'id')||'/'||(a->>'id')||'/test.txt',false),'Outsider cannot read files';
  result := public.cw_call('join_room',jsonb_build_object('number',room->>'number'));
  assert result->'room'->>'id'=room->>'id','Room number grants access';
  result := public.cw_call('wall',jsonb_build_object('room_id',room->>'id'));
  assert jsonb_array_length(result->'posts')=1 and (result->>'members')::int=2,'New member sees shared posts';
  assert private.cw_file_allowed((room->>'id')||'/'||(a->>'id')||'/test.txt',false),'Member can read files';
  assert not private.cw_file_allowed((room->>'id')||'/'||(a->>'id')||'/test.txt',true),'Member cannot upload as another person';
  result := public.cw_call('delete_post',jsonb_build_object('room_id',room->>'id','post_id',posted->>'id'));
  assert result ? 'error','Other members cannot remove someone else’s post';
  result := public.cw_call('post',jsonb_build_object('room_id',room->>'id','content','hello from B','author_id',a->>'id'));
  assert result->>'ok'='true','Member B can post';
  result := public.cw_call('wall',jsonb_build_object('room_id',room->>'id'));
  assert exists(select 1 from jsonb_array_elements(result->'posts') p where p->>'content'='hello from B' and p->>'author_id'=b->>'id'), 'Caller cannot spoof author';
  perform public.cw_call('logout');
  result := public.cw_call('me');
  assert result->>'unauthorized'='true','Logout revokes token at the database';
  assert not private.cw_file_allowed((room->>'id')||'/'||(b->>'id')||'/test.txt',true),'Revoked session cannot upload';
  for i in 1..20 loop
    result := public.cw_call('login',jsonb_build_object('code',a->>'supercode'));
  end loop;
  assert result ? 'error' and not result ? 'token', 'Repeated supercode attempts are rate limited';
  begin
    perform 1 from private.cw_people;
    raise exception 'Raw private tables must not be readable';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
