"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import ClipBody from "@/components/ClipBody";
import ClipFile from "@/components/ClipFile";
import LoginGate from "@/components/LoginGate";
import { FILE_BUCKET, formatBytes, sanitizeFileName, validateWallFile } from "@/lib/files";
import { comicSpring, tapPress } from "@/lib/motion";
import { Clip, Profile, Room, supabase, Workspace } from "@/lib/supabase";

type InviteResult = { code: string; expires_at: string };

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function hoursLeft(expiresAt: string) {
  const left = new Date(expiresAt).getTime() - Date.now();
  if (left <= 0) return "vanishing";
  const h = Math.ceil(left / 3600000);
  return `${h}h left`;
}

function nameFromUser(user: User) {
  const candidate = user.user_metadata?.display_name;
  if (typeof candidate === "string" && candidate.trim().length >= 2) {
    return candidate.trim().slice(0, 48);
  }
  return user.email?.split("@")[0]?.slice(0, 48) || "Copywaller";
}

function roomRetentionLabel(hours: number) {
  if (hours < 24) return `${hours}h`;
  if (hours % 24 === 0) return `${hours / 24}d`;
  return `${hours}h`;
}

export default function Board() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingClips, setLoadingClips] = useState(false);
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [retentionHours, setRetentionHours] = useState(24);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [pendingInvite, setPendingInvite] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const code = new URLSearchParams(window.location.search).get("join")?.trim().toUpperCase();
    return code && /^[A-Z0-9]{10}$/.test(code) ? code : null;
  });
  const reduced = useReducedMotion();

  const selectedWorkspace = useMemo(
    () => workspaces.find((space) => space.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );
  const isWorkspaceOwner = selectedWorkspace?.owner_id === user?.id;

  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (alive) {
        setUser(data.user);
        setAuthReady(true);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadWorkspaces = useCallback(async () => {
    if (!user) return [];
    setLoadingSpaces(true);
    const { data, error: queryError } = await supabase
      .from("workspaces")
      .select("id, name, owner_id, created_at")
      .order("created_at", { ascending: true });
    setLoadingSpaces(false);
    if (queryError) {
      setError("Could not open your spaces. Run the Copywall SQL setup if this is a new deployment.");
      return [];
    }
    const next = (data ?? []) as Workspace[];
    setWorkspaces(next);
    setSelectedWorkspaceId((current) =>
      current && next.some((space) => space.id === current) ? current : (next[0]?.id ?? null),
    );
    return next;
  }, [user]);

  const ensureProfile = useCallback(async () => {
    if (!user) return;
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) {
      setError("Could not load your account. Run the Copywall SQL setup first.");
      return;
    }
    if (data) {
      setProfile(data as Profile);
      return;
    }
    const fallback = nameFromUser(user);
    const { data: created, error: createError } = await supabase
      .from("profiles")
      .upsert({ id: user.id, display_name: fallback })
      .select("id, display_name")
      .single();
    if (createError) {
      setError("Could not finish setting up your profile.");
      return;
    }
    setProfile(created as Profile);
  }, [user]);

  useEffect(() => {
    if (!user) {
      queueMicrotask(() => {
        setProfile(null);
        setWorkspaces([]);
        setRooms([]);
        setClips([]);
        setSelectedWorkspaceId(null);
        setSelectedRoomId(null);
      });
      return;
    }
    queueMicrotask(() => {
      void ensureProfile();
      void loadWorkspaces();
    });
  }, [ensureProfile, loadWorkspaces, user]);

  const loadRooms = useCallback(async () => {
    if (!selectedWorkspaceId) {
      setRooms([]);
      return [];
    }
    const { data, error: queryError } = await supabase
      .from("rooms")
      .select("id, workspace_id, name, retention_hours, created_by, created_at")
      .eq("workspace_id", selectedWorkspaceId)
      .order("created_at", { ascending: true });
    if (queryError) {
      setError("Could not load the rooms in this space.");
      return [];
    }
    const next = (data ?? []) as Room[];
    setRooms(next);
    setSelectedRoomId((current) =>
      current && next.some((room) => room.id === current) ? current : (next[0]?.id ?? null),
    );
    return next;
  }, [selectedWorkspaceId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadRooms();
      setInviteLink(null);
    });
  }, [loadRooms]);

  const loadClips = useCallback(async () => {
    if (!selectedRoomId) {
      setClips([]);
      return;
    }
    setLoadingClips(true);
    const { data, error: queryError } = await supabase
      .from("clips")
      .select("id, room_id, author_id, author_name, content, created_at, expires_at, file_path, file_name, file_size, mime_type")
      .eq("room_id", selectedRoomId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (queryError) {
      setError("Could not load this wall.");
      setLoadingClips(false);
      return;
    }
    setClips((data ?? []) as Clip[]);
    setLoadingClips(false);
  }, [selectedRoomId]);

  useEffect(() => {
    queueMicrotask(() => void loadClips());
    if (!selectedRoomId) return;
    const channel = supabase
      .channel(`copywall:room:${selectedRoomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clips", filter: `room_id=eq.${selectedRoomId}` },
        () => void loadClips(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadClips, selectedRoomId]);

  const claimInvite = useCallback(async () => {
    if (!user || !pendingInvite) return;
    const { data, error: joinError } = await supabase.rpc("join_workspace_with_invite", {
      p_code: pendingInvite,
    });
    setPendingInvite(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("join");
    window.history.replaceState({}, "", url);
    if (joinError) {
      setError(joinError.message);
      return;
    }
    await loadWorkspaces();
    setSelectedWorkspaceId(data as string);
    setNotice("You’re in. Pick a room and start sharing.");
  }, [loadWorkspaces, pendingInvite, user]);

  useEffect(() => {
    queueMicrotask(() => void claimInvite());
  }, [claimInvite]);

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    const name = newWorkspaceName.trim();
    if (name.length < 2) {
      setError("Give your space a name first.");
      return;
    }
    if (!user) return;
    setCreatingSpace(true);
    setError(null);
    const { data, error: createError } = await supabase
      .from("workspaces")
      .insert({ name, owner_id: user.id })
      .select("id, name, owner_id, created_at")
      .single();
    setCreatingSpace(false);
    if (createError || !data) {
      setError(createError?.message || "Could not create that space.");
      return;
    }
    setNewWorkspaceName("");
    setShowNewWorkspace(false);
    await loadWorkspaces();
    setSelectedWorkspaceId((data as Workspace).id);
    setShowNewRoom(true);
    setNotice("Space made. Create its first private wall.");
  }

  async function createRoom(event: FormEvent) {
    event.preventDefault();
    const name = newRoomName.trim();
    if (!selectedWorkspaceId || !user) return;
    if (name.length < 2) {
      setError("Give the wall a room name.");
      return;
    }
    setCreatingRoom(true);
    setError(null);
    const { data, error: createError } = await supabase
      .from("rooms")
      .insert({
        workspace_id: selectedWorkspaceId,
        name,
        retention_hours: retentionHours,
        created_by: user.id,
      })
      .select("id, workspace_id, name, retention_hours, created_by, created_at")
      .single();
    setCreatingRoom(false);
    if (createError || !data) {
      setError(createError?.message || "Could not create that room.");
      return;
    }
    setNewRoomName("");
    setShowNewRoom(false);
    await loadRooms();
    setSelectedRoomId((data as Room).id);
    setNotice("Private wall ready.");
  }

  async function createInvite() {
    if (!selectedWorkspaceId) return;
    setCreatingInvite(true);
    setError(null);
    const { data, error: inviteError } = await supabase.rpc("create_workspace_invite", {
      p_workspace_id: selectedWorkspaceId,
      p_expires_in_hours: 168,
    });
    setCreatingInvite(false);
    const invite = Array.isArray(data) ? (data[0] as InviteResult | undefined) : undefined;
    if (inviteError || !invite) {
      setError(inviteError?.message || "Could not create an invite.");
      return;
    }
    const url = new URL(window.location.origin);
    url.searchParams.set("join", invite.code);
    setInviteLink(url.toString());
    setNotice("Invite made. It expires in seven days.");
  }

  async function copyText(text: string, feedback: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(feedback);
    } catch {
      setError("Clipboard access was blocked. Copy it manually instead.");
    }
  }

  async function onPaste(event: FormEvent) {
    event.preventDefault();
    const trimmedContent = content.trim();
    if (!user || !profile || !selectedRoom) return;
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
        uploadedPath = `${selectedRoom.id}/${user.id}/${crypto.randomUUID()}/${sanitizeFileName(file.name)}`;
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
        room_id: selectedRoom.id,
        author_id: user.id,
        author_name: profile.display_name,
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
    } catch (caught) {
      if (uploadedPath) await supabase.storage.from(FILE_BUCKET).remove([uploadedPath]);
      setError(caught instanceof Error ? caught.message : "Paste did not stick. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function copyClip(clip: Clip) {
    try {
      let text = clip.content.trim() ? clip.content : "";
      if (!text && clip.file_path) {
        const { data, error: linkError } = await supabase.storage
          .from(FILE_BUCKET)
          .createSignedUrl(clip.file_path, 60 * 30);
        if (linkError || !data?.signedUrl) throw linkError || new Error("No file link available");
        text = data.signedUrl;
      }
      if (!text) return;
      await navigator.clipboard.writeText(text);
      setCopiedId(clip.id);
      window.setTimeout(() => setCopiedId((id) => (id === clip.id ? null : id)), 1600);
    } catch {
      setError("Clipboard blocked this copy. Long-press the text instead.");
    }
  }

  async function ripClip(clip: Clip) {
    const canDelete = clip.author_id === user?.id || isWorkspaceOwner;
    if (!canDelete) return;
    const { error: deleteError } = await supabase.from("clips").delete().eq("id", clip.id);
    if (deleteError) {
      setError("Could not rip that panel.");
      return;
    }
    if (clip.file_path && clip.author_id === user?.id) {
      await supabase.storage.from(FILE_BUCKET).remove([clip.file_path]);
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
    if (clip.author_id !== user?.id) return;
    const next = draft.trim();
    if (!next && !clip.file_path) {
      setError("An edit still needs text.");
      return;
    }
    const { error: updateError } = await supabase
      .from("clips")
      .update({ content: next })
      .eq("id", clip.id);
    if (updateError) {
      setError("Edit did not stick. Try again.");
      return;
    }
    setClips((current) => current.map((item) => (item.id === clip.id ? { ...item, content: next } : item)));
    setEditingId(null);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setNotice(null);
    setError(null);
  }

  const countLabel = `${clips.length} panel${clips.length === 1 ? "" : "s"} on this wall`;
  const empty = !loadingClips && selectedRoom && clips.length === 0;

  if (!authReady) return null;

  if (!user) {
    return <LoginGate onAuthenticated={() => undefined} />;
  }

  return (
    <motion.div
      className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 sm:py-10"
      initial={reduced ? false : { opacity: 0, y: 28, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={comicSpring}
    >
      <header className="comic-outline relative overflow-hidden bg-yellow">
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-16 top-[-40px] h-48 w-48 rotate-12 rounded-full bg-magenta mix-blend-multiply"
          animate={reduced ? undefined : { rotate: [12, 20, 12], x: [0, 10, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative flex flex-col gap-5 px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="font-sans text-[11px] font-extrabold uppercase tracking-[0.32em] text-ink">
              Private group clipboard
            </p>
            <div className="flex items-center gap-2">
              <span className="comic-outline-sm bg-bubble px-2.5 py-1 font-sans text-[11px] font-extrabold uppercase tracking-widest">
                {profile?.display_name || "Opening..."}
              </span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="font-sans text-[11px] font-extrabold uppercase tracking-widest underline decoration-2 underline-offset-4"
              >
                Out
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-[clamp(3.4rem,8vw,6.4rem)] font-black italic leading-[0.82] tracking-tight text-ink">
                Copywall
              </h1>
              <p className="mt-4 max-w-md font-sans text-sm font-medium leading-relaxed sm:text-base">
                Private rooms for the code, links, and files your group needs right now.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewWorkspace((showing) => !showing)}
              className="comic-outline-sm bg-ink px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest text-yellow"
            >
              + New space
            </button>
          </div>
        </div>
      </header>

      {error ? <p className="mt-5 comic-outline-sm bg-punch px-3 py-2 text-sm font-bold text-bubble">{error}</p> : null}
      {notice ? <p className="mt-5 comic-outline-sm bg-cyan px-3 py-2 text-sm font-bold">{notice}</p> : null}

      <AnimatePresence initial={false}>
        {showNewWorkspace ? (
          <motion.form
            onSubmit={(event) => void createWorkspace(event)}
            className="comic-outline mt-6 bg-bubble p-4"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 font-sans text-xs font-extrabold uppercase tracking-widest">
                Space name
                <input
                  autoFocus
                  value={newWorkspaceName}
                  onChange={(event) => setNewWorkspaceName(event.target.value)}
                  maxLength={80}
                  placeholder="e.g. CS-3B practicals"
                  className="mt-1 w-full comic-outline-sm bg-paper px-3 py-2 font-sans text-base font-semibold outline-none"
                />
              </label>
              <motion.button
                type="submit"
                disabled={creatingSpace}
                className="comic-outline-sm bg-magenta px-4 py-2.5 font-sans text-xs font-extrabold uppercase tracking-widest text-bubble disabled:opacity-60"
                whileTap={tapPress.whileTap}
              >
                {creatingSpace ? "Making..." : "Create space"}
              </motion.button>
            </div>
          </motion.form>
        ) : null}
      </AnimatePresence>

      <main className="mt-6 grid flex-1 gap-6 lg:grid-cols-[260px_minmax(280px,380px)_1fr]">
        <aside className="comic-outline h-fit bg-bubble p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-3xl font-black italic">Spaces</h2>
            <span className="stamp comic-outline-sm bg-cyan px-2 py-1 text-[10px] font-extrabold uppercase">Private</span>
          </div>
          {loadingSpaces ? <p className="mt-3 font-sans text-sm font-medium">Opening your spaces...</p> : null}
          {!loadingSpaces && workspaces.length === 0 ? (
            <div className="mt-4 border-t-2 border-ink pt-4 font-sans text-sm leading-6">
              Make a space for a class, project, club, or friend group. Each space gets its own invite-only rooms.
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {workspaces.map((space) => (
                <button
                  key={space.id}
                  type="button"
                  onClick={() => setSelectedWorkspaceId(space.id)}
                  className={`w-full text-left comic-outline-sm px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest ${
                    selectedWorkspaceId === space.id ? "bg-magenta text-bubble" : "bg-paper"
                  }`}
                >
                  {space.name}
                </button>
              ))}
            </div>
          )}

          {selectedWorkspace ? (
            <>
              <div className="mt-6 flex items-center justify-between gap-2 border-t-2 border-ink pt-4">
                <h3 className="font-display text-2xl font-black italic">Rooms</h3>
                <button
                  type="button"
                  onClick={() => setShowNewRoom((showing) => !showing)}
                  className="comic-outline-sm bg-yellow px-2 py-1 font-sans text-[10px] font-extrabold uppercase tracking-widest"
                >
                  + Room
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => setSelectedRoomId(room.id)}
                    className={`w-full text-left comic-outline-sm px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest ${
                      selectedRoomId === room.id ? "bg-ink text-yellow" : "bg-paper"
                    }`}
                  >
                    {room.name}
                  </button>
                ))}
                {!rooms.length ? <p className="font-sans text-sm font-medium">No rooms yet.</p> : null}
              </div>
              {isWorkspaceOwner ? (
                <div className="mt-5 border-t-2 border-ink pt-4">
                  <button
                    type="button"
                    onClick={() => void createInvite()}
                    disabled={creatingInvite}
                    className="w-full comic-outline-sm bg-cyan px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest disabled:opacity-60"
                  >
                    {creatingInvite ? "Making link..." : "Make invite link"}
                  </button>
                  {inviteLink ? (
                    <div className="mt-3">
                      <p className="break-all font-mono text-[11px] leading-5">{inviteLink}</p>
                      <button
                        type="button"
                        onClick={() => void copyText(inviteLink, "Invite link copied.")}
                        className="mt-2 comic-outline-sm bg-yellow px-2 py-1 font-sans text-[10px] font-extrabold uppercase tracking-widest"
                      >
                        Copy invite
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </aside>

        <section className="min-w-0">
          <AnimatePresence initial={false}>
            {showNewRoom && selectedWorkspace ? (
              <motion.form
                onSubmit={(event) => void createRoom(event)}
                className="comic-outline halftone-panel bg-cyan p-4 sm:p-5"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
              >
                <div className="relative z-10">
                  <h2 className="font-display text-3xl font-black italic">New private wall</h2>
                  <label className="mt-3 block font-sans text-xs font-extrabold uppercase tracking-widest">
                    Room name
                    <input
                      autoFocus
                      value={newRoomName}
                      onChange={(event) => setNewRoomName(event.target.value)}
                      maxLength={80}
                      placeholder="e.g. DBMS Lab A"
                      className="mt-1 w-full comic-outline-sm bg-bubble px-3 py-2.5 font-sans text-base font-semibold outline-none"
                    />
                  </label>
                  <label className="mt-3 block font-sans text-xs font-extrabold uppercase tracking-widest">
                    Posts disappear after
                    <select
                      value={retentionHours}
                      onChange={(event) => setRetentionHours(Number(event.target.value))}
                      className="mt-1 w-full comic-outline-sm bg-bubble px-3 py-2.5 font-sans text-sm font-bold outline-none"
                    >
                      <option value={24}>24 hours</option>
                      <option value={72}>3 days</option>
                      <option value={168}>7 days</option>
                      <option value={720}>30 days</option>
                    </select>
                  </label>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="submit"
                      disabled={creatingRoom}
                      className="comic-outline bg-magenta px-4 py-2.5 font-sans text-xs font-extrabold uppercase tracking-widest text-bubble disabled:opacity-60"
                    >
                      {creatingRoom ? "Making..." : "Create room"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowNewRoom(false)}
                      className="comic-outline-sm bg-paper px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.form>
            ) : selectedRoom ? (
              <section className="comic-outline halftone-panel bg-cyan p-4 sm:p-5">
                <div className="relative z-10">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-sans text-[11px] font-extrabold uppercase tracking-widest text-ink/70">{selectedWorkspace?.name}</p>
                      <h2 className="font-display text-3xl font-black italic">{selectedRoom.name}</h2>
                    </div>
                    <span className="stamp comic-outline-sm bg-yellow px-2 py-1 text-[10px] font-extrabold uppercase">
                      {roomRetentionLabel(selectedRoom.retention_hours)} wall
                    </span>
                  </div>
                  <form onSubmit={(event) => void onPaste(event)} className="flex flex-col gap-3">
                    <p className="font-sans text-xs font-extrabold uppercase tracking-widest text-ink/80">
                      Posting as {profile?.display_name || "..."}
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
                        <button type="button" onClick={() => setFile(null)} className="ml-2 underline decoration-2 underline-offset-2">Clear</button>
                      </p>
                    ) : null}
                    <motion.button
                      type="submit"
                      disabled={saving || !profile}
                      className="comic-outline bg-magenta px-4 py-3 font-display text-2xl font-black italic text-bubble disabled:opacity-60"
                      whileHover={saving ? undefined : tapPress.whileHover}
                      whileTap={saving ? undefined : tapPress.whileTap}
                    >
                      {saving ? "Sticking..." : "Paste to this wall"}
                    </motion.button>
                  </form>
                </div>
              </section>
            ) : (
              <section className="comic-outline bg-cyan p-6">
                <h2 className="font-display text-4xl font-black italic">Start a space.</h2>
                <p className="mt-2 font-sans text-sm font-medium leading-6">
                  Create a space, then add a room for each class, lab, project, or group chat that needs its own wall.
                </p>
              </section>
            )}
          </AnimatePresence>
        </section>

        <section className="min-w-0">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-3xl font-black italic sm:text-4xl">The Wall</h2>
              <p className="font-sans text-xs font-bold uppercase tracking-[0.2em] text-ink/70">
                {loadingClips ? "Opening the press..." : selectedRoom ? countLabel : "Choose a room"}
              </p>
            </div>
          </div>
          {empty ? (
            <div className="comic-outline bg-bubble p-8 text-center">
              <p className="font-display text-3xl font-black italic">Blank page!</p>
              <p className="mt-2 font-sans text-sm font-medium">Be the first to paste. Only people in this space can see it.</p>
            </div>
          ) : clips.length ? (
            <motion.ul className="grid gap-5 sm:grid-cols-2" layout>
              <AnimatePresence>
                {clips.map((clip, index) => {
                  const restRotate = index % 3 === 0 ? -1.2 : index % 3 === 1 ? 1.2 : 0;
                  const copied = copiedId === clip.id;
                  const own = clip.author_id === user.id;
                  const canRip = own || isWorkspaceOwner;
                  const editing = editingId === clip.id;
                  return (
                    <motion.li
                      key={clip.id}
                      layout
                      initial={reduced ? false : { opacity: 0, y: 28, scale: 0.9, rotate: -6 }}
                      animate={{ opacity: 1, y: 0, scale: 1, rotate: restRotate }}
                      exit={{ opacity: 0, scale: 0.82, rotate: 8, y: -12 }}
                      whileHover={reduced ? undefined : { y: -6, rotate: 0, zIndex: 2 }}
                      transition={comicSpring}
                    >
                      <article className="speech-tail comic-outline bg-bubble p-4 pb-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-display text-2xl font-black italic leading-none">{clip.author_name}</p>
                            <p className="mt-1 font-sans text-[11px] font-bold uppercase tracking-widest text-ink/60">
                              {timeAgo(clip.created_at)} · {hoursLeft(clip.expires_at)}
                            </p>
                          </div>
                          {copied ? <span className="stamp comic-outline-sm bg-punch px-2 py-1 text-[10px] font-extrabold uppercase tracking-widest text-bubble">Copied!</span> : null}
                        </div>
                        {editing ? (
                          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={7} className="mt-3 w-full resize-y comic-outline-sm bg-paper px-3 py-2.5 font-sans text-sm leading-6 outline-none" />
                        ) : clip.content.trim() ? <ClipBody content={clip.content} /> : null}
                        {clip.file_path && clip.file_name ? <ClipFile fileName={clip.file_name} filePath={clip.file_path} fileSize={clip.file_size} mimeType={clip.mime_type} /> : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <motion.button type="button" onClick={() => void copyClip(clip)} className="flex-1 comic-outline-sm bg-yellow px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest" whileHover={tapPress.whileHover} whileTap={tapPress.whileTap}>
                            {clip.file_path && !clip.content.trim() ? "Copy link" : "Copy"}
                          </motion.button>
                          {own ? (editing ? <>
                            <button type="button" onClick={() => void saveEdit(clip)} className="comic-outline-sm bg-cyan px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest">Save</button>
                            <button type="button" onClick={() => setEditingId(null)} className="comic-outline-sm bg-paper px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest">Cancel</button>
                          </> : <button type="button" onClick={() => startEdit(clip)} className="comic-outline-sm bg-paper px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest">Edit</button>) : null}
                          {canRip ? <motion.button type="button" onClick={() => void ripClip(clip)} className="comic-outline-sm bg-paper px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest" whileHover={tapPress.whileHover} whileTap={tapPress.whileTap}>Rip</motion.button> : null}
                        </div>
                      </article>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </motion.ul>
          ) : selectedRoom ? null : (
            <div className="comic-outline bg-bubble p-8 text-center font-sans text-sm font-medium">Your private wall will appear here.</div>
          )}
        </section>
      </main>

      <footer className="mt-10 pb-4 text-center font-sans text-[11px] font-bold uppercase tracking-[0.25em] text-ink/60">
        Copywall · Private spaces, instant sharing
      </footer>
    </motion.div>
  );
}
