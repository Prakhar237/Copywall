# Clip Tell

A shared comic clipboard for a small group. Paste from any device, copy on another. Name + text live on one wall in Supabase and auto-delete after 24 hours.

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
3. Deploy.

Anyone with the live URL can read, paste, and delete clips. Share it only with your group.
