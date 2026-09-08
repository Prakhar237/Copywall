# Copywall

Email → save your supercode → enter a room number → paste, copy, share.

## Active experience

- Enter an email to receive a six-character uppercase alphanumeric supercode **on screen once**. Save it before continuing.
- Return from any device using just that code. No password, confirmation email, workspace, or group step.
- Join using a six-digit room number, or create a named room and share its number/link.
- Room information starts hidden. Open the sidebar when needed, then hide it to give the wall more space. Mobile uses a dismissible drawer with keyboard focus containment.
- Share text, code, links, and files up to 50 MB. Posts disappear from the wall after 24 hours; visible tabs refresh every four seconds.
- The author or room creator can remove a post. Other members can read, copy, and download it.

## Setup

1. Apply [`supabase/simple-rooms.sql`](supabase/simple-rooms.sql) **once**, before deploying this client. It was installed on the linked project as migration `simple_rooms_supercode_access`.
2. Provide `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` and Vercel. These are public client configuration; never substitute a service-role key.
3. Run `npm ci` and `npm run dev`.

The active flow uses Supabase Database and Storage, but not Supabase Auth or an email provider. The linked Vercel project deploys from `main`.

## Sessions and access

This is a deliberately lightweight prototype: **emails are not verified**. They are identifiers, not proof of ownership. An already registered email cannot reveal or reset its code. There is no recovery flow yet; losing the code means losing access to that identity.

Supercodes are stored as hashes. Each successful login creates a random 256-bit, revocable session lasting 12 hours, kept in the browser tab’s `sessionStorage`. Log out on shared lab computers. Database-backed attempt limits reduce online guessing, but six-character credentials are not appropriate for sensitive information or a public commercial launch without stronger abuse controls and verified recovery.

Knowing a room number grants membership. Share it only with your people; this is not a confidential-room invitation system. Private tables have RLS enabled and no direct client grants. A public invoker RPC delegates to internal functions that validate sessions and membership. Storage also checks those sessions and membership; downloads use short-lived signed URLs from a private bucket.

Post expiry hides posts; it does **not** reclaim stored files. Scheduled storage cleanup and quota enforcement are follow-up work before opening this to a large audience.

## Legacy mode

`src/app/page.tsx` comments out the old `Board` import and renders `SimpleWall`. The old password-login components, Supabase Auth accounts, workspace tables, rooms, and `wall-files` bucket remain intact for rollback. Existing users get new supercodes; legacy private content is not automatically assigned to unverified email identities or exposed through room numbers.

## Verification

- `npm run lint` and `npm run build`
- [`supabase/simple-rooms.test.sql`](supabase/simple-rooms.test.sql): transactional, rollback-only authorization checks against an installed schema.
- `node scripts/test-simple-wall.mjs` with the public environment variables: cross-device login, private upload/download, member isolation, author enforcement, and logout checks against the real API. It removes the uploaded file and prints the disposable database fixture IDs for explicit cleanup.
