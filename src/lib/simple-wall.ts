import { createClient } from "@supabase/supabase-js";

export const SESSION_KEY = "copywall.simple.session";
export const ROOM_KEY = "copywall.simple.room";
export const SIMPLE_BUCKET = "simple-wall-files";
export type Person = { id: string; name: string };
export type SimpleRoom = { id: string; number: string; name: string; owner_id: string; created_at: string };
export type Post = {
  id: string; room_id: string; author_id: string; author_name: string;
  content: string; created_at: string; expires_at: string;
  file_path: string | null; file_name: string | null;
  file_size: number | null; mime_type: string | null;
};

// Supabase password Auth is disabled in the active UI. The legacy Board and
// LoginGate remain in the repository for rollback. This client never reads or
// refreshes legacy Supabase sessions; it uses our separate supercode session.
export function wallClient(token = "") {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-copywall-session": token } },
  });
}
export type WallClient = ReturnType<typeof wallClient>;
export class SessionEnded extends Error {}
export async function call<T>(client: WallClient, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc("cw_call", { p_action: action, p_data: payload });
  if (error) throw new Error(error.message);
  if (data?.unauthorized) throw new SessionEnded(data.error);
  if (data?.error) throw new Error(data.error);
  if (!data) throw new Error("Copywall could not complete that request. Try again.");
  return data as T;
}
