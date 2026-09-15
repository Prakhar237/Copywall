"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import ClipBody from "@/components/ClipBody";
import ClipFile from "@/components/ClipFile";
import LoginGate from "@/components/LoginGate";
import { comicSpring, tapPress } from "@/lib/motion";
import {
  FILE_BUCKET,
  formatBytes,
  sanitizeFileName,
  validateWallFile,
} from "@/lib/files";
import {
  CREW,
  CrewName,
  RIP_WINDOW_MS,
  SESSION_KEY,
  canRipClip,
  isAdmin,
  isOwnClip,
  ripSecondsLeft,
} from "@/lib/crew";
import {
  CLIP_TTL_HOURS,
  Clip,
  supabase,
} from "@/lib/supabase";

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
  const [session, setSession] = useState<CrewName | null>(null);
  const [ready, setReady] = useState(false);
  const [content, setContent] = useState("");
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [now, setNow] = useState(Date.now());
  const reduced = useReducedMotion();

  useEffect(() => {
    const saved = window.localStorage.getItem(SESSION_KEY);
    const crew = saved
      ? CREW.find((name) => name === saved) ?? null
      : null;
    if (crew) setSession(crew);
    setReady(true);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const purgeExpired = useCallback(async () => {
    const cutoff = new Date(
      Date.now() - CLIP_TTL_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const { data: expired } = await supabase
      .from("clips")
      .select("file_path")
      .lt("created_at", cutoff)
      .not("file_path", "is", null);
    const paths = (expired ?? [])
      .map((row) => row.file_path)
      .filter((path): path is string => Boolean(path));
    if (paths.length) {
      await supabase.storage.from(FILE_BUCKET).remove(paths);
    }
    await supabase.from("clips").delete().lt("created_at", cutoff);
  }, []);

  const loadClips = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from("clips")
      .select(
        "id, author_name, content, created_at, file_path, file_name, file_size, mime_type",
      )
      .order("created_at", { ascending: false });

    if (queryError) {
      setError("Could not load the board. Check your connection.");
      return;
    }

    setClips((data ?? []) as Clip[]);
    setError(null);
  }, []);

  useEffect(() => {
    if (!session) return;
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
      .channel("copywall")
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
  }, [loadClips, purgeExpired, session]);

  function enter(name: CrewName) {
    window.localStorage.setItem(SESSION_KEY, name);
    setSession(name);
  }

  function leave() {
    window.localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setClips([]);
    setContent("");
    setFile(null);
    setEditingId(null);
  }

  async function onPaste(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    const trimmedContent = content.trim();

    if (!trimmedContent && !file) {
      setError("Paste text or attach a file.");
      return;
    }

    if (file) {
      const fileError = validateWallFile(file);
      if (fileError) {
        setError(fileError);
        return;
      }
    }

    setSaving(true);
    setError(null);

    let uploadedPath: string | null = null;
    try {
      if (file) {
        uploadedPath = `${session}/${crypto.randomUUID()}/${sanitizeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from(FILE_BUCKET)
          .upload(uploadedPath, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type || undefined,
          });
        if (uploadError) throw uploadError;
      }

      const { error: insertError } = await supabase.from("clips").insert({
        author_name: session,
        content: trimmedContent,
        file_path: uploadedPath,
        file_name: file ? sanitizeFileName(file.name) : null,
        file_size: file ? file.size : null,
        mime_type: file ? file.type || null : null,
      });

      if (insertError) throw insertError;

      setContent("");
      setFile(null);
      await loadClips();
    } catch {
      if (uploadedPath) {
        await supabase.storage.from(FILE_BUCKET).remove([uploadedPath]);
      }
      setError("Paste did not stick. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function copyClip(clip: Clip) {
    try {
      const text = clip.content.trim()
        ? clip.content
        : clip.file_path
          ? supabase.storage.from(FILE_BUCKET).getPublicUrl(clip.file_path).data
              .publicUrl
          : "";
      if (!text) return;
      await navigator.clipboard.writeText(text);
      setCopiedId(clip.id);
      window.setTimeout(() => setCopiedId((id) => (id === clip.id ? null : id)), 1600);
    } catch {
      setError("Clipboard blocked this copy. Long-press the text instead.");
    }
  }

  async function ripClip(clip: Clip) {
    if (!session || !canRipClip(clip.author_name, clip.created_at, session, Date.now())) {
      return;
    }
    if (clip.file_path) {
      await supabase.storage.from(FILE_BUCKET).remove([clip.file_path]);
    }
    const { error: deleteError } = await supabase.from("clips").delete().eq("id", clip.id);
    if (deleteError) {
      setError("Could not rip that panel.");
      return;
    }
    setClips((current) => current.filter((item) => item.id !== clip.id));
    if (editingId === clip.id) setEditingId(null);
  }

  function startEdit(clip: Clip) {
    setEditingId(clip.id);
    setDraft(clip.content);
    setError(null);
  }

  async function saveEdit(clip: Clip) {
    if (!session || !isOwnClip(clip.author_name, session)) return;
    const next = draft.trim();
    if (!next && !clip.file_path) {
      setError("An edit still needs text.");
      return;
    }

    const { error: updateError } = await supabase
      .from("clips")
      .update({ content: next })
      .eq("id", clip.id)
      .eq("author_name", session);

    if (updateError) {
      setError("Edit did not stick. Try again.");
      return;
    }

    setClips((current) =>
      current.map((item) =>
        item.id === clip.id ? { ...item, content: next } : item,
      ),
    );
    setEditingId(null);
  }

  const empty = !loading && clips.length === 0;
  const countLabel = useMemo(() => {
    void now;
    return `${clips.length} panel${clips.length === 1 ? "" : "s"} on the wall`;
  }, [clips.length, now]);

  if (!ready) {
    return null;
  }

  return (
    <AnimatePresence mode="wait">
      {!session ? (
        <motion.div
          key="login"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.94, rotate: 2, y: 16 }}
          transition={comicSpring}
        >
          <LoginGate onEnter={enter} />
        </motion.div>
      ) : (
        <motion.div
          key="board"
          className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 sm:py-10"
          initial={reduced ? false : { opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12 }}
          transition={comicSpring}
        >
      <motion.header
        className="comic-outline relative overflow-hidden bg-yellow"
        initial={reduced ? false : { opacity: 0, scale: 1.16, rotate: -4, y: -32 }}
        animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
        transition={comicSpring}
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-16 top-[-40px] h-48 w-48 rotate-12 rounded-full bg-magenta mix-blend-multiply"
          animate={reduced ? undefined : { rotate: [12, 20, 12], x: [0, 10, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -bottom-16 left-8 h-32 w-32 rounded-full bg-cyan mix-blend-multiply"
          animate={reduced ? undefined : { y: [0, -10, 0], x: [0, 6, 0] }}
          transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative flex flex-col gap-5 px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="font-sans text-[11px] font-extrabold uppercase tracking-[0.32em] text-ink">
              Crew of four · Lives 24 hours
            </p>
            <div className="flex items-center gap-2">
              {isAdmin(session) ? (
                <span className="stamp comic-outline-sm bg-punch px-2 py-1 text-[10px] font-extrabold uppercase tracking-widest text-bubble">
                  Admin
                </span>
              ) : null}
              <span className="comic-outline-sm bg-bubble px-2.5 py-1 font-sans text-[11px] font-extrabold uppercase tracking-widest">
                {session}
              </span>
              <button
                type="button"
                onClick={leave}
                className="font-sans text-[11px] font-extrabold uppercase tracking-widest underline decoration-2 underline-offset-4"
              >
                Out
              </button>
            </div>
          </div>

          <div className="max-w-3xl">
            <h1 className="font-display text-[clamp(3.4rem,8vw,6.4rem)] font-black italic leading-[0.82] tracking-tight text-ink">
              Copywall
            </h1>
            <p className="mt-4 max-w-md font-sans text-sm font-medium leading-relaxed sm:text-base">
              Phone to laptop, no chat hop. Paste it here. Copy it there.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {CREW.map((crew, index) => (
              <motion.span
                key={crew}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...comicSpring, delay: 0.15 + index * 0.05 }}
                className={`comic-outline-sm px-2.5 py-1 font-sans text-[10px] font-extrabold uppercase tracking-widest ${
                  crew === session ? "bg-ink text-yellow" : "bg-bubble"
                }`}
              >
                {crew}
              </motion.span>
            ))}
          </div>
        </div>
      </motion.header>

      <main className="mt-6 grid flex-1 gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <motion.section
          className="comic-outline halftone-panel h-fit bg-cyan p-4 sm:p-5"
          initial={reduced ? false : { opacity: 0, x: -28, rotate: -2 }}
          animate={{ opacity: 1, x: 0, rotate: 0 }}
          transition={{ ...comicSpring, delay: reduced ? 0 : 0.08 }}
        >
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
              <p className="font-sans text-xs font-extrabold uppercase tracking-widest text-ink/80">
                Posting as {session}
              </p>

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

              <label className="font-sans text-xs font-extrabold uppercase tracking-widest">
                File · up to 50 MB
                <input
                  type="file"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setError(null);
                  }}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.rtf,.odt,.ods,.odp,.png,.jpg,.jpeg,.gif,.webp,.svg,.zip,.7z,.mp3,.mp4,.mov,.json,.xml,.md"
                  className="mt-1 w-full font-sans text-sm file:mr-3 file:comic-outline-sm file:border-0 file:bg-yellow file:px-3 file:py-1.5 file:font-sans file:text-xs file:font-extrabold file:uppercase file:tracking-widest"
                />
              </label>
              {file ? (
                <p className="font-sans text-xs font-bold">
                  {file.name} · {formatBytes(file.size)}
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="ml-2 underline decoration-2 underline-offset-2"
                  >
                    Clear
                  </button>
                </p>
              ) : null}

              {error ? (
                <p className="comic-outline-sm bg-punch px-3 py-2 text-sm font-bold text-bubble">
                  {error}
                </p>
              ) : null}

              <motion.button
                type="submit"
                disabled={saving}
                className="comic-outline bg-magenta px-4 py-3 font-display text-2xl font-black italic text-bubble disabled:opacity-60"
                whileHover={saving ? undefined : tapPress.whileHover}
                whileTap={saving ? undefined : tapPress.whileTap}
              >
                {saving ? "Sticking..." : "Paste to the wall"}
              </motion.button>
            </form>
          </div>
        </motion.section>

        <motion.section
          initial={reduced ? false : { opacity: 0, x: 24, rotate: 2 }}
          animate={{ opacity: 1, x: 0, rotate: 0 }}
          transition={{ ...comicSpring, delay: reduced ? 0 : 0.14 }}
        >
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
            <motion.ul className="grid gap-5 sm:grid-cols-2" layout>
              <AnimatePresence>
              {clips.map((clip, index) => {
                const restRotate =
                  index % 3 === 0 ? -1.2 : index % 3 === 1 ? 1.2 : 0;
                const copied = copiedId === clip.id;
                const own = isOwnClip(clip.author_name, session);
                const showRip = canRipClip(
                  clip.author_name,
                  clip.created_at,
                  session,
                  now,
                );
                const showEdit = own;
                const editing = editingId === clip.id;
                const seconds = ripSecondsLeft(clip.created_at, now);
                const showTimer =
                  own &&
                  !isAdmin(session) &&
                  now - new Date(clip.created_at).getTime() < RIP_WINDOW_MS;

                return (
                  <motion.li
                    key={clip.id}
                    layout
                    initial={
                      reduced
                        ? false
                        : { opacity: 0, y: 28, scale: 0.9, rotate: -6 }
                    }
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: 1,
                      rotate: restRotate,
                    }}
                    exit={{ opacity: 0, scale: 0.82, rotate: 8, y: -12 }}
                    whileHover={reduced ? undefined : { y: -6, rotate: 0, zIndex: 2 }}
                    transition={comicSpring}
                  >
                    <article className="speech-tail comic-outline bg-bubble p-4 pb-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-2xl font-black italic leading-none">
                            {clip.author_name}
                          </p>
                          <p className="mt-1 font-sans text-[11px] font-bold uppercase tracking-widest text-ink/60">
                            {timeAgo(clip.created_at)} · {hoursLeft(clip.created_at)}
                            {showTimer ? ` · Rip ${seconds}s` : ""}
                          </p>
                        </div>
                        {copied ? (
                          <motion.span
                            initial={{ opacity: 0, scale: 1.5, rotate: -14 }}
                            animate={{ opacity: 1, scale: 1, rotate: -8 }}
                            transition={comicSpring}
                            className="comic-outline-sm bg-punch px-2 py-1 text-[10px] font-extrabold uppercase tracking-widest text-bubble"
                          >
                            Copied!
                          </motion.span>
                        ) : null}
                      </div>

                      {editing ? (
                        <textarea
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          rows={7}
                          className="mt-3 w-full resize-y comic-outline-sm bg-paper px-3 py-2.5 font-sans text-sm leading-6 outline-none"
                        />
                      ) : clip.content.trim() ? (
                        <ClipBody content={clip.content} />
                      ) : null}
                      {clip.file_path && clip.file_name ? (
                        <ClipFile
                          fileName={clip.file_name}
                          filePath={clip.file_path}
                          fileSize={clip.file_size}
                          mimeType={clip.mime_type}
                        />
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <motion.button
                          type="button"
                          onClick={() => void copyClip(clip)}
                          className="flex-1 comic-outline-sm bg-yellow px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest"
                          whileHover={tapPress.whileHover}
                          whileTap={tapPress.whileTap}
                        >
                          {clip.file_path && !clip.content.trim()
                            ? "Copy link"
                            : "Copy"}
                        </motion.button>
                        {showEdit ? (
                          editing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void saveEdit(clip)}
                                className="comic-outline-sm bg-cyan px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="comic-outline-sm bg-paper px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEdit(clip)}
                              className="comic-outline-sm bg-paper px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest"
                            >
                              Edit
                            </button>
                          )
                        ) : null}
                        {showRip ? (
                          <motion.button
                            type="button"
                            onClick={() => void ripClip(clip)}
                            className="comic-outline-sm bg-paper px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest"
                            whileHover={tapPress.whileHover}
                            whileTap={tapPress.whileTap}
                          >
                            Rip
                          </motion.button>
                        ) : null}
                      </div>
                    </article>
                  </motion.li>
                );
              })}
              </AnimatePresence>
            </motion.ul>
          )}
        </motion.section>
      </main>

      <footer className="mt-10 pb-4 text-center font-sans text-[11px] font-bold uppercase tracking-[0.25em] text-ink/60">
        Copywall · Auto-rips after 24 hours
      </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
