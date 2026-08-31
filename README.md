# Copywall

A shared comic clipboard for Prakhar, Arhem, Nipun, and Gokul. Paste from any device, copy on another. Notes live 24 hours.

## Login

- Names: `Prakhar`, `Arhem`, `Nipun`, `Gokul` (any case)
- Pass: `1234`

Prakhar can rip any note. Everyone else can edit their own notes, and can rip their own note only for the first 15 seconds.

Files (PDF, Word, Excel, images, zip, and similar) can go on the wall too, up to 50 MB. They vanish with the note after 24 hours.

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

If **Edit → Save** does not stick, run this in the Supabase SQL editor:

```sql
drop policy if exists clips_update_public on public.clips;

create policy clips_update_public
  on public.clips for update
  to anon, authenticated
  using (true)
  with check (true);
```

## Vercel

1. Push the repo and import it in Vercel.
2. Add the same two environment variables.
3. Deploy.
