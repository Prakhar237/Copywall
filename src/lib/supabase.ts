import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export const supabase = createClient(url, key);

export type Profile = {
  id: string;
  display_name: string;
};

export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
};

export type Room = {
  id: string;
  workspace_id: string;
  name: string;
  retention_hours: number;
  created_by: string;
  created_at: string;
};

export type Clip = {
  id: string;
  room_id: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: string;
  expires_at: string;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
};
