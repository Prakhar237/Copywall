"use client";

import { FormEvent, useMemo, useState } from "react";
import { call, Person, wallClient } from "@/lib/simple-wall";

type Access = Person & { token: string; supercode: string | null };
export default function SupercodeGate({ onEnter }: { onEnter: (person: Person, token: string) => void }) {
  const client = useMemo(() => wallClient(), []);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [issued, setIssued] = useState<Access | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await call<Access>(client, mode, mode === "register" ? { email } : { code });
      if (result.supercode) setIssued(result);
      else onEnter({ id: result.id, name: result.name }, result.token);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open Copywall. Try again."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5 py-12">
    <header className="comic-outline relative bg-yellow p-7 sm:p-9">
      <p className="text-xs font-extrabold uppercase tracking-[0.3em]">A room. A code. A wall.</p>
      <h1 className="mt-3 font-display text-6xl font-black italic sm:text-7xl">Copywall</h1>
      <p className="mt-4 text-base font-medium leading-7">Paste here. Pick it up anywhere.<br />Code, text, and files for your whole room.</p>
    </header>
    <section className="comic-outline relative z-10 -mt-1 bg-bubble p-6 sm:p-8">
      {issued ? <>
        <p className="text-xs font-extrabold uppercase tracking-widest">Your supercode</p>
        <h2 className="mt-2 font-display text-3xl font-black italic">Keep this one close.</h2>
        <output aria-label="Your supercode" className="my-6 block comic-outline-sm bg-yellow p-4 text-center font-mono text-4xl font-black tracking-[0.18em] sm:text-5xl">{issued.supercode}</output>
        <p className="text-sm leading-6">Save this code. It’s your login on any device, and anyone with it can use your account. We only show it here once.</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button className="cw-button bg-paper" onClick={async () => {
            try { await navigator.clipboard.writeText(issued.supercode!); setCopied(true); }
            catch { setError("Select the code above and copy it manually."); }
          }}>{copied ? "Copied!" : "Copy supercode"}</button>
          <button className="cw-button flex-1 bg-ink text-yellow" onClick={() => onEnter({ id: issued.id, name: issued.name }, issued.token)}>I saved it →</button>
        </div>
      </> : <>
        <div className="mb-6 grid grid-cols-2 gap-3">
          <button className={`cw-button ${mode === "register" ? "bg-cyan" : "bg-paper"}`} onClick={() => { setMode("register"); setError(""); }}>Get a supercode</button>
          <button className={`cw-button ${mode === "login" ? "bg-cyan" : "bg-paper"}`} onClick={() => { setMode("login"); setError(""); }}>I have a code</button>
        </div>
        <form onSubmit={submit}>
          <label className="block text-sm font-bold">
            {mode === "register" ? "Your email" : "Your supercode"}
            {mode === "register" ? <input key="email" className="cw-input mt-2" type="email" autoComplete="email" required maxLength={254} placeholder="you@college.edu" value={email} onChange={e => setEmail(e.target.value)} />
              : <input key="code" className="cw-input mt-2 font-mono text-2xl uppercase tracking-[0.25em]" autoComplete="off" autoCapitalize="characters" spellCheck={false} required minLength={6} maxLength={6} pattern="[A-Za-z0-9]{6}" placeholder="A7B2C9" value={code} onChange={e => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())} />}
          </label>
          <p className="mt-3 text-xs leading-5 text-ink/65">{mode === "register" ? "Your code appears here immediately. No password or email confirmation." : "Six letters and numbers. No email or password needed."}</p>
          <button disabled={busy} className="cw-button mt-6 w-full bg-magenta text-bubble">{busy ? "Opening…" : mode === "register" ? "Get my supercode →" : "Open Copywall →"}</button>
        </form>
      </>}
      {error && <p role="alert" className="mt-5 text-sm font-bold text-punch">{error}</p>}
    </section>
    <p className="mt-6 text-center text-xs leading-5 text-ink/65">Made for the lab, the library, and the last-minute handoff.</p>
  </main>;
}
