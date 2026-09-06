# Copywall

Private, instant sharing walls for study groups, labs, projects, and clubs. Create a space, add private rooms, invite your people, and paste text, code, links, or files from any device.

Every account gets its own identity. Every workspace is private. A room’s posts auto-expire after the retention period chosen when the room is created.

## First-time Supabase setup

This release replaces the old shared-password wall with Supabase Auth and private Row Level Security policies.

1. In the Supabase dashboard, open **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql).
2. In **Authentication → Providers**, enable Email. Keep email confirmation enabled for a production app.
3. In **Authentication → URL Configuration**, add your deployed site URL (for example `https://copywall.vercel.app`) as a redirect URL.
4. In **Database → Replication**, enable Realtime for `public.clips` so new posts appear immediately for everyone in a room.

The SQL makes the `wall-files` bucket private. Files are addressed through short-lived signed URLs and can only be read by members of the matching room.

## Local

```bash
npm install
cp .env.example .env.local
```

Fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Then:

```bash
npm run dev
```

## Vercel

1. Push the repo and import it in Vercel.
2. Add the same two environment variables.
3. Deploy. Add the Vercel URL to Supabase Auth’s redirect URLs before testing sign-up.

## Product model

```text
Workspace (class, club, friend group)
  └─ Room (one private wall)
      └─ Text, code, link, or file posts
```

Only a workspace owner can create invite links. Links work for seven days and let a person join that workspace and all of its rooms. Any workspace member can create a room; the person who creates a room chooses how long posts last: 24 hours, 3 days, 7 days, or 30 days.
