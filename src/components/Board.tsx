"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CLIP_TTL_HOURS,
  Clip,
  supabase,
} from "@/lib/supabase";

const NAME_KEY = "clip-tell-name";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function hoursLeft(iso: string) {
  const expires = new Date(iso).getTime() + CLIP_TTL_HOURS * 60 * 60 * 1000;
  const left = expires - Date.now();
  if (left <= 0) return "vanishing";
  const h = Math.ceil(left / 3600000);
  return `${h}h left`;
}

export default function Board() {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const saved = window.localStorage.getItem(NAME_KEY);
    if (saved) setName(saved);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const purgeExpired = useCallback(async () => {
    const cutoff = new Date(
      Date.now() - CLIP_TTL_HOURS * 60 * 60 * 1000,
    ).toISOString();
    await supabase.from("clips").delete().lt("created_at", cutoff);
  }, []);

  const loadClips = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from("clips")
      .select("id, author_name, content, created_at")
      .order("created_at", { ascending: false });

    if (queryError) {
      setError("Could not load the board. Check your connection.");
      return;
    }

    setClips((data ?? []) as Clip[]);
    setError(null);
  }, []);

  useEffect(() => {
    let alive = true;

    const boot = async () => {
      setLoading(true);
      await purgeExpired();
      if (!alive) return;
      await loadClips();
      if (alive) setLoading(false);
    };

    void boot();

    const channel = supabase
      .channel("clip-tell-wall")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clips" },
        () => {
          void loadClips();
        },
      )
      .subscribe();

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [loadClips, purgeExpired]);

  async function onPaste(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedContent = content.trim();

    if (!trimmedName || !trimmedContent) {
      setError("Name and paste both need ink.");
      return;
    }

    setSaving(true);
    setError(null);
    window.localStorage.setItem(NAME_KEY, trimmedName);

    const { error: insertError } = await supabase.from("clips").insert({
      author_name: trimmedName,
      content: trimmedContent,
    });

    setSaving(false);

    if (insertError) {
      setError("Paste did not stick. Try again.");
      return;
    }

    setContent("");
    await loadClips();
  }

  async function copyClip(clip: Clip) {
    try {
      await navigator.clipboard.writeText(clip.content);
      setCopiedId(clip.id);
      window.setTimeout(() => setCopiedId((id) => (id === clip.id ? null : id)), 1600);
    } catch {
      setError("Clipboard blocked this copy. Long-press the text instead.");
    }
  }

  async function ripClip(id: string) {
    const { error: deleteError } = await supabase.from("clips").delete().eq("id", id);
    if (deleteError) {
      setError("Could not rip that panel.");
      return;
    }
    setClips((current) => current.filter((clip) => clip.id !== id));
  }

  const empty = !loading && clips.length === 0;
  const countLabel = useMemo(() => {
    void now;
    return `${clips.length} panel${clips.length === 1 ? "" : "s"} on the wall`;
  }, [clips.length, now]);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 sm:py-10">
      <header className="comic-outline relative overflow-hidden bg-yellow px-5 py-6 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rotate-12 rounded-full bg-magenta" />
        <div className="pointer-events-none absolute -bottom-10 left-10 h-24 w-24 rounded-full bg-cyan" />
        <p className="relative font-sans text-[11px] font-extrabold uppercase tracking-[0.35em] text-ink">
          Issue No. 01 · Students only · Vanishes in 24h
        </p>
        <h1 className="relative mt-2 font-display text-5xl font-black italic leading-[0.9] tracking-tight text-ink sm:text-7xl">
          CLIP TELL
        </h1>
        <p className="relative mt-3 max-w-xl font-sans text-sm font-medium leading-relaxed text-ink sm:text-base">
          Paste on this phone. Copy on that laptop. No WhatsApp hop, no mail
          chain — just the wall.
        </p>
      </header>

      <main className="mt-6 grid flex-1 gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <section className="comic-outline halftone-panel h-fit bg-cyan p-4 sm:p-5">
          <div className="relative z-10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-3xl font-black italic">
                Paste Booth
              </h2>
              <span className="stamp comic-outline-sm bg-yellow px-2 py-1 text-[10px] font-extrabold uppercase">
                Stick it
              </span>
            </div>

            <form onSubmit={onPaste} className="flex flex-col gap-3">
              <label className="font-sans text-xs font-extrabold uppercase tracking-widest">
                Your name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={40}
                  placeholder="Who's posting?"
                  className="mt-1 w-full comic-outline-sm bg-bubble px-3 py-2.5 font-sans text-base font-semibold outline-none placeholder:text-ink/40"
                />
              </label>

              <label className="font-sans text-xs font-extrabold uppercase tracking-widest">
                The goods
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  maxLength={20000}
                  rows={8}
                  placeholder="Drop notes, links, codes, whatever..."
                  className="mt-1 w-full resize-y comic-outline-sm bg-bubble px-3 py-2.5 font-sans text-sm leading-6 outline-none placeholder:text-ink/40"
                />
              </label>

              {error ? (
                <p className="comic-outline-sm bg-punch px-3 py-2 text-sm font-bold text-bubble">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={saving}
                className="comic-outline bg-magenta px-4 py-3 font-display text-2xl font-black italic text-bubble transition-transform hover:-translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-60"
              >
                {saving ? "Sticking..." : "Paste to the wall"}
              </button>
            </form>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-3xl font-black italic sm:text-4xl">
                The Wall
              </h2>
              <p className="font-sans text-xs font-bold uppercase tracking-[0.2em] text-ink/70">
                {loading ? "Opening the press..." : countLabel}
              </p>
            </div>
          </div>

          {empty ? (
            <div className="comic-outline bg-bubble p-8 text-center">
              <p className="font-display text-3xl font-black italic">
                Blank page!
              </p>
              <p className="mt-2 font-sans text-sm font-medium">
                Be the first to paste. Everyone here sees it instantly.
              </p>
            </div>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2">
              {clips.map((clip, index) => {
                const tilt =
                  index % 3 === 0
                    ? "-rotate-1"
                    : index % 3 === 1
                      ? "rotate-1"
                      : "rotate-0";
                const copied = copiedId === clip.id;
                return (
                  <li key={clip.id} className={tilt}>
                    <article className="speech-tail comic-outline bg-bubble p-4 pb-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-2xl font-black italic leading-none">
                            {clip.author_name}
                          </p>
                          <p className="mt-1 font-sans text-[11px] font-bold uppercase tracking-widest text-ink/60">
                            {timeAgo(clip.created_at)} · {hoursLeft(clip.created_at)}
                          </p>
                        </div>
                        {copied ? (
                          <span className="slam-in comic-outline-sm bg-punch px-2 py-1 text-[10px] font-extrabold uppercase tracking-widest text-bubble">
                            Copied!
                          </span>
                        ) : null}
                      </div>
                      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-6">
                        {clip.content}
                      </pre>
                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void copyClip(clip)}
                          className="flex-1 comic-outline-sm bg-yellow px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest transition-transform hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => void ripClip(clip.id)}
                          className="comic-outline-sm bg-paper px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest transition-transform hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                        >
                          Rip
                        </button>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <footer className="mt-10 pb-4 text-center font-sans text-[11px] font-bold uppercase tracking-[0.25em] text-ink/60">
        Shared board · Auto-rips after 24 hours · Anyone with the link can read
      </footer>
    </div>
  );
}
