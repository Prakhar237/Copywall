"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import SupercodeGate from "@/components/SupercodeGate";
import ClipBody from "@/components/ClipBody";
import { call, Person, Post, ROOM_KEY, SESSION_KEY, SIMPLE_BUCKET, SessionEnded, SimpleRoom, WallClient, wallClient } from "@/lib/simple-wall";
import { formatBytes, sanitizeFileName, validateWallFile } from "@/lib/files";

function Attachment({ post, client }: { post: Post; client: WallClient }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    if (!post.file_path || busy) return;
    setBusy(true); setError("");
    try {
      const { data, error } = await client.storage.from(SIMPLE_BUCKET).createSignedUrl(post.file_path, 60, { download: post.file_name || true });
      if (error || !data) throw new Error("Could not download. Your session may have ended; refresh and try again.");
      const link = document.createElement("a"); link.href = data.signedUrl; link.download = post.file_name || "file";
      document.body.appendChild(link); link.click(); link.remove();
    } catch (e) { setError(e instanceof Error ? e.message : "Download failed."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4">
    <button className="comic-outline-sm flex w-full min-w-0 items-center justify-between gap-3 bg-paper p-3 text-left" disabled={busy} onClick={() => void download()}>
      <span className="min-w-0"><span className="block truncate text-sm font-bold">{post.file_name}</span><span className="text-xs text-ink/60">{formatBytes(post.file_size || 0)}</span></span>
      <span className="text-xs font-extrabold uppercase">{busy ? "Opening…" : "Download ↓"}</span>
    </button>
    {error && <p role="alert" className="mt-2 text-xs text-punch">{error}</p>}
  </div>;
}

export default function SimpleWall() {
  const [token, setToken] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [ready, setReady] = useState(false);
  const [rooms, setRooms] = useState<SimpleRoom[]>([]);
  const [room, setRoom] = useState<SimpleRoom | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [members, setMembers] = useState(0);
  const [sidebar, setSidebar] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [newName, setNewName] = useState("");
  const [createMode, setCreateMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingWall, setLoadingWall] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wallError, setWallError] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const client = useMemo(() => wallClient(token), [token]);
  const fileInput = useRef<HTMLInputElement>(null);
  const sidebarButton = useRef<HTMLButtonElement>(null);
  const sidebarClose = useRef<HTMLButtonElement>(null);

  const fail = useCallback((e: unknown) => {
    if (e instanceof SessionEnded) {
      sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(ROOM_KEY);
      setPerson(null); setToken(""); setRoom(null); setRooms([]); setPosts([]); setSidebar(false);
    }
    setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
  }, []);

  useEffect(() => {
    let alive = true;
    async function restore() {
      const saved = sessionStorage.getItem(SESSION_KEY);
      const incoming = new URL(window.location.href).searchParams.get("room");
      if (incoming && /^\d{6}$/.test(incoming)) setRoomNumber(incoming);
      if (!saved) { if (alive) setReady(true); return; }
      try {
        const savedClient = wallClient(saved);
        const [identity, list] = await Promise.all([call<Person>(savedClient, "me"), call<{ rooms: SimpleRoom[] }>(savedClient, "rooms")]);
        if (!alive) return;
        setToken(saved); setPerson(identity); setRooms(list.rooms);
        if (!incoming) setRoom(list.rooms.find(r => r.id === sessionStorage.getItem(ROOM_KEY)) || null);
      } catch (e) {
        if (!alive) return;
        if (e instanceof SessionEnded) sessionStorage.removeItem(SESSION_KEY);
        else setRestoreError("Could not reconnect to Copywall. Check your connection, then retry.");
      } finally { if (alive) setReady(true); }
    }
    void restore(); return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!room) return;
    let alive = true; let inFlight = false;
    const currentRoom = room;
    async function refresh() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const data = await call<{ posts: Post[]; members: number }>(client, "wall", { room_id: currentRoom.id });
        if (alive) { setPosts(data.posts); setMembers(data.members); setLoadingWall(false); setWallError(""); }
      } catch (e) {
        if (alive) {
          if (e instanceof SessionEnded) fail(e);
          else setWallError("Reconnecting to the wall… Your posts will refresh when the connection returns.");
          setLoadingWall(false);
        }
      }
      finally { inFlight = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [client, room, fail]);

  useEffect(() => {
    if (!sidebar) return;
    sidebarClose.current?.focus();
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const previousOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSidebar(false); sidebarButton.current?.focus(); }
      if (mobile && e.key === "Tab") {
        const buttons = document.querySelectorAll<HTMLButtonElement>("#room-sidebar button:not(:disabled)");
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("keydown", close); document.body.style.overflow = previousOverflow; };
  }, [sidebar]);

  async function enter(identity: Person, session: string) {
    sessionStorage.setItem(SESSION_KEY, session);
    setToken(session); setPerson(identity); setError(""); setNotice("");
    try { setRooms((await call<{ rooms: SimpleRoom[] }>(wallClient(session), "rooms")).rooms); }
    catch (e) { fail(e); }
  }
  function openRoom(next: SimpleRoom) {
    setRoom(next); setPosts([]); setMembers(0); setLoadingWall(true); setSidebar(false);
    setError(""); setNotice(""); setWallError(""); setText(""); setFile(null);
    sessionStorage.setItem(ROOM_KEY, next.id);
    const url = new URL(window.location.href); url.searchParams.delete("room"); window.history.replaceState({}, "", url);
  }
  async function chooseRoom(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const data = await call<{ room: SimpleRoom }>(client, createMode ? "create_room" : "join_room", createMode ? { name: newName.trim() } : { number: roomNumber });
      setRooms(current => [data.room, ...current.filter(r => r.id !== data.room.id)]);
      openRoom(data.room);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function copy(value: string, message: string) {
    try { await navigator.clipboard.writeText(value); setNotice(message); }
    catch { setError("Clipboard access was blocked. Select and copy the text manually."); }
  }
  async function post(event: FormEvent) {
    event.preventDefault(); if (!room || !person || busy) return;
    const target = room; setBusy(true); setError("");
    let uploaded: string | null = null;
    try {
      if (file) {
        const validation = validateWallFile(file); if (validation) throw new Error(validation);
        uploaded = `${target.id}/${person.id}/${crypto.randomUUID()}/${sanitizeFileName(file.name)}`;
        const { error } = await client.storage.from(SIMPLE_BUCKET).upload(uploaded, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (error) { uploaded = null; throw new Error(error.message); }
      }
      await call(client, "post", { room_id: target.id, content: text.trim(), file_path: uploaded,
        file_name: file ? sanitizeFileName(file.name) : null, file_size: file?.size ?? null, mime_type: file?.type ?? null });
      uploaded = null; // The file now belongs to a saved post; don't clean it up if refresh fails.
      setText(""); setFile(null); if (fileInput.current) fileInput.current.value = "";
      setNotice("On the wall!");
      const data = await call<{ posts: Post[] }>(client, "wall", { room_id: target.id }); setPosts(data.posts);
    } catch (e) {
      if (uploaded) await client.storage.from(SIMPLE_BUCKET).remove([uploaded]);
      fail(e);
    } finally { setBusy(false); }
  }
  async function remove(post: Post) {
    if (busy || !room) return; setBusy(true); setError("");
    try {
      await call(client, "delete_post", { room_id: room.id, post_id: post.id });
      setPosts(current => current.filter(p => p.id !== post.id));
      // File removal is allowed for its uploader; owner moderation hides the post.
      if (post.file_path && post.author_id === person?.id) await client.storage.from(SIMPLE_BUCKET).remove([post.file_path]);
      setNotice("Post removed.");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return; setBusy(true);
    try {
      await call(client, "logout"); sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(ROOM_KEY);
      setToken(""); setPerson(null); setRoom(null); setRooms([]); setPosts([]); setSidebar(false); setNotice(""); setError("");
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  if (!ready) return <main className="grid min-h-dvh place-items-center font-bold">Opening Copywall…</main>;
  if (restoreError) return <main className="grid min-h-dvh place-content-center gap-5 p-6"><p role="alert">{restoreError}</p><button className="cw-button bg-yellow" onClick={() => window.location.reload()}>Retry connection</button></main>;
  if (!person) return <SupercodeGate onEnter={(identity, session) => void enter(identity, session)} />;

  return <div className="min-h-dvh">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b-4 border-ink bg-yellow px-5 py-4 sm:px-8">
      <div className="flex items-center gap-4"><h1 className="font-display text-3xl font-black italic sm:text-4xl">Copywall</h1><span className="hidden text-xs font-bold uppercase tracking-widest sm:block">Paste. Copy. Done.</span></div>
      <div className="flex items-center gap-3"><span className="max-w-32 truncate text-sm font-bold">{person.name}</span><button disabled={busy} className="text-xs font-extrabold uppercase underline underline-offset-4" onClick={() => void logout()}>Log out</button></div>
    </header>
    {!room ? <main className="mx-auto max-w-2xl px-5 py-12 sm:py-20">
      <p className="text-xs font-extrabold uppercase tracking-[0.3em]">Straight to the wall</p>
      <h2 className="mt-3 font-display text-4xl font-black italic sm:text-6xl">Got a room number?</h2>
      <p className="mt-4 text-sm leading-6">Enter your friend’s number and you’re in. Or make a room and share its number.</p>
      <form className="comic-outline mt-8 bg-bubble p-6" onSubmit={chooseRoom}>
        <div className="mb-6 flex gap-3"><button type="button" className={`cw-button flex-1 ${!createMode ? "bg-cyan" : "bg-paper"}`} onClick={() => { setCreateMode(false); setError(""); }}>Join room</button><button type="button" className={`cw-button flex-1 ${createMode ? "bg-cyan" : "bg-paper"}`} onClick={() => { setCreateMode(true); setError(""); }}>Create room</button></div>
        <label className="text-sm font-bold">{createMode ? "Room name" : "Room number"}
          {createMode ? <input key="name" className="cw-input mt-2" required minLength={2} maxLength={80} placeholder="e.g. DBMS lab" value={newName} onChange={e => setNewName(e.target.value)} /> : <input key="number" className="cw-input mt-2 font-mono text-3xl tracking-[0.25em]" inputMode="numeric" pattern="[0-9]{6}" autoComplete="off" required minLength={6} maxLength={6} placeholder="123456" value={roomNumber} onChange={e => setRoomNumber(e.target.value.replace(/\D/g, ""))} />}
        </label>
        <button disabled={busy} className="cw-button mt-5 w-full bg-magenta text-bubble">{busy ? "Opening…" : createMode ? "Create my room →" : "Go to wall →"}</button>
        <p className="mt-4 text-xs leading-5 text-ink/65">Anyone with the room number can join. Share it with your people.</p>
      </form>
      {error && <p role="alert" className="mt-5 font-bold text-punch">{error}</p>}
      {rooms.length > 0 && <section className="mt-10"><h3 className="text-xs font-extrabold uppercase tracking-widest">Your recent rooms</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{rooms.map(r => <button key={r.id} className="comic-outline-sm flex min-w-0 items-center justify-between gap-3 bg-bubble p-4 text-left" onClick={() => openRoom(r)}><span className="truncate font-bold">{r.name}</span><span className="font-mono text-sm">#{r.number}</span></button>)}</div></section>}
    </main> : <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink/20 bg-bubble px-5 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-4"><button ref={sidebarButton} disabled={busy} aria-expanded={sidebar} aria-controls="room-sidebar" className="cw-button bg-paper" onClick={() => setSidebar(v => !v)}>{sidebar ? "Hide info ←" : "Room info →"}</button><div className="min-w-0"><h2 className="truncate font-bold">{room.name}</h2><button className="font-mono text-sm" title="Copy room number" onClick={() => void copy(room.number, "Room number copied.")}>#{room.number} ⧉</button></div></div>
        <button disabled={busy} className="text-xs font-extrabold uppercase underline underline-offset-4" onClick={() => { setRoom(null); setSidebar(false); sessionStorage.removeItem(ROOM_KEY); }}>Change room</button>
      </div>
      <div className="flex items-start">
        {sidebar && <button aria-label="Close room sidebar" tabIndex={-1} className="fixed inset-0 z-30 bg-ink/40 md:hidden" onClick={() => { setSidebar(false); sidebarButton.current?.focus(); }} />}
        {sidebar && <aside id="room-sidebar" aria-label="Room information" className="cw-sidebar shrink-0 border-r-4 border-ink bg-bubble p-6">
          <div className="flex items-center justify-between"><h3 className="font-display text-3xl font-black italic">The room</h3><button ref={sidebarClose} aria-label="Hide room information" className="cw-button bg-paper" onClick={() => { setSidebar(false); sidebarButton.current?.focus(); }}>←</button></div>
          <p className="mt-8 text-xs font-extrabold uppercase tracking-widest">Share this number</p><p className="mt-3 font-mono text-4xl font-black tracking-widest">{room.number}</p>
          <button className="cw-button mt-5 w-full bg-yellow" onClick={() => void copy(room.number, "Room number copied.")}>Copy number</button>
          <button className="cw-button mt-3 w-full bg-cyan" onClick={() => void copy(`${window.location.origin}/?room=${room.number}`, "Room link copied.")}>Copy room link</button>
          <dl className="mt-8 space-y-4 text-sm"><div><dt className="text-ink/60">People in the room</dt><dd className="font-bold">{members}</dd></div><div><dt className="text-ink/60">Posts stay for</dt><dd className="font-bold">24 hours</dd></div><div><dt className="text-ink/60">File limit</dt><dd className="font-bold">50 MB per file</dd></div></dl>
          <p className="mt-6 text-xs leading-6 text-ink/60">Anyone with this number can join this wall. Your personal supercode stays yours.</p>
        </aside>}
        <main className="min-w-0 flex-1 p-5 sm:p-8">
          <form onSubmit={post} className="comic-outline bg-bubble p-4 sm:p-5">
            <label htmlFor="wall-content" className="text-xs font-extrabold uppercase tracking-widest">Drop something on the wall</label>
            <textarea id="wall-content" className="mt-3 min-h-28 w-full resize-y bg-transparent font-mono text-sm leading-6 outline-none" placeholder="Paste code, a link, or a quick note…" value={text} maxLength={100000} onChange={e => setText(e.target.value)} disabled={busy} />
            {file && <div className="mb-4 flex items-center gap-3 text-sm"><span className="min-w-0 truncate font-bold">{file.name} · {formatBytes(file.size)}</span><button type="button" disabled={busy} className="shrink-0 underline" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}>Remove</button></div>}
            <div className="flex items-center justify-between gap-3 border-t-2 border-ink/15 pt-4">
              <input ref={fileInput} id="wall-file" type="file" className="sr-only" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (!f) return; const validation = validateWallFile(f); if (validation) { setError(validation); e.target.value = ""; return; } setError(""); setFile(f); }} />
              <button type="button" className="cw-button bg-paper" disabled={busy} onClick={() => fileInput.current?.click()}>Attach file +</button>
              <button className="cw-button bg-magenta text-bubble" disabled={busy || (!text.trim() && !file)}>{busy ? "Working…" : "Post to wall ↑"}</button>
            </div>
          </form>
          <div aria-live="polite">{notice && <p className="mt-5 text-sm font-bold">{notice}</p>}</div>
          {wallError && <p role="status" className="mt-5 text-sm font-bold text-punch">{wallError}</p>}
          {error && <p role="alert" className="mt-5 text-sm font-bold text-punch">{error}</p>}
          <div className="mb-5 mt-9 flex items-end justify-between"><h3 className="font-display text-3xl font-black italic">The wall</h3><span className="text-xs font-bold text-ink/60">Updates every few seconds</span></div>
          {loadingWall ? <p className="py-10 text-center">Loading your wall…</p> : posts.length === 0 ? <div className="comic-outline-sm bg-yellow p-10 text-center"><h4 className="font-display text-3xl font-black italic">First one’s yours.</h4><p className="mt-3 text-sm">Paste something above. Everyone in room {room.number} will see it here.</p></div> : <div className="grid items-start gap-6 md:grid-cols-2 2xl:grid-cols-3">{posts.map(p => <article key={p.id} className="comic-outline min-w-0 bg-bubble p-5">
            <div className="flex items-center justify-between gap-3"><span className="truncate text-xs font-extrabold uppercase">{p.author_name}</span><time dateTime={p.created_at} className="shrink-0 text-xs text-ink/60">{new Date(p.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
            {p.content && <ClipBody content={p.content} />}
            {p.file_path && <Attachment post={p} client={client} />}
            <div className="mt-5 flex items-center justify-between gap-3 border-t-2 border-ink/15 pt-3">{p.content ? <button className="cw-button bg-yellow" onClick={() => void copy(p.content, "Copied!")}>Copy ⧉</button> : <span className="text-xs text-ink/60">File post</span>}{(p.author_id===person.id || room.owner_id===person.id) && <button disabled={busy} className="text-xs font-bold underline" onClick={() => void remove(p)}>Remove post</button>}</div>
          </article>)}</div>}
        </main>
      </div>
    </>}
  </div>;
}
