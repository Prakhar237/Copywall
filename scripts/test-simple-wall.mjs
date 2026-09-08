// Integration smoke test. Use an isolated Supabase project where possible.
// Creates two clearly named test accounts and one room; prints fixture IDs for
// database cleanup. Removes the uploaded file before finishing.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert(url && key, 'Supabase public environment variables are required');
const client = (token = '') => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-copywall-session': token } },
});
async function raw(c, action, data = {}) {
  const result = await c.rpc('cw_call', { p_action: action, p_data: data });
  assert.equal(result.error, null, result.error?.message);
  return result.data;
}
async function call(c, action, data = {}) {
  const result = await raw(c, action, data); assert(!result.error, result.error); return result;
}
const prefix = `cw-api-test-${Date.now()}`;
const guest = client();
const a = await call(guest, 'register', { email: `${prefix}-a@example.invalid` });
const b = await call(guest, 'register', { email: `${prefix}-b@example.invalid` });
console.log(JSON.stringify({ fixturePeople: [a.id, b.id], emails: [`${prefix}-a@example.invalid`, `${prefix}-b@example.invalid`] }));
const owner = client(a.token), other = client(b.token);
assert.match(a.supercode, /^[A-Z0-9]{6}$/);
const login = await call(guest, 'login', { code: a.supercode.toLowerCase() });
assert.equal(login.id, a.id); assert.notEqual(login.token, a.token);
assert((await raw(guest, 'register', { email: `${prefix}-a@example.invalid` })).error);
const { room } = await call(owner, 'create_room', { name: 'API integration test room' });
console.log(JSON.stringify({ fixtureRoom: room.id }));
assert((await raw(other, 'wall', { room_id: room.id })).error);
const path = `${room.id}/${a.id}/${crypto.randomUUID()}/test.txt`;
let uploaded = false;
try {
  const upload = await owner.storage.from('simple-wall-files').upload(path, new Blob(['Copywall file roundtrip'], { type: 'text/plain' }));
  assert.equal(upload.error, null, upload.error?.message); uploaded = true;
  console.log('PASS: session-authenticated file upload');
  const denied = await other.storage.from('simple-wall-files').createSignedUrl(path, 60);
  assert(denied.error, 'Non-member must not receive a download link');
  console.log('PASS: non-member file access denied');
  await call(owner, 'post', { room_id: room.id, content: 'file roundtrip', file_path: path, file_name: 'test.txt', file_size: 23, mime_type: 'text/plain' });
  await call(other, 'join_room', { number: room.number });
  const wall = await call(other, 'wall', { room_id: room.id });
  assert.equal(wall.members, 2); assert.equal(wall.posts[0].author_id, a.id);
  const signed = await other.storage.from('simple-wall-files').createSignedUrl(path, 60);
  assert.equal(signed.error, null, signed.error?.message);
  const response = await fetch(signed.data.signedUrl);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'Copywall file roundtrip');
  console.log('PASS: joined member downloads exact uploaded content');
  assert((await raw(other, 'delete_post', { room_id: room.id, post_id: wall.posts[0].id })).error);
  await call(owner, 'delete_post', { room_id: room.id, post_id: wall.posts[0].id });
  await call(other, 'logout'); assert((await raw(other, 'me')).unauthorized);
  console.log('PASS: author enforcement and session revocation');
} finally {
  if (uploaded) {
    const removed = await owner.storage.from('simple-wall-files').remove([path]);
    assert.equal(removed.error, null, removed.error?.message);
    console.log('Removed uploaded test file');
  }
}
