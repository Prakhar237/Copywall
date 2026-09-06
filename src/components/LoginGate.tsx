"use client";

import { FormEvent, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { comicSpring, tapPress } from "@/lib/motion";
import { supabase } from "@/lib/supabase";

type Props = {
  onAuthenticated: () => void;
};

function cleanDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export default function LoginGate({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const reduced = useReducedMotion();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = cleanDisplayName(displayName);

    if (!normalizedEmail || !password) {
      setError("Add your email and password first.");
      return;
    }
    if (mode === "signup" && (normalizedName.length < 2 || normalizedName.length > 48)) {
      setError("Use a display name between 2 and 48 characters.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: { display_name: normalizedName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage("Check your email to confirm your account, then come back to Copywall.");
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) throw signInError;
      }
      onAuthenticated();
    } catch (caught) {
      const copy = caught instanceof Error ? caught.message : "Could not get you into Copywall.";
      setError(copy);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
      <motion.div
        className="comic-outline relative overflow-hidden bg-yellow px-6 py-7 sm:px-8"
        initial={reduced ? false : { opacity: 0, scale: 1.22, rotate: -7, y: -36 }}
        animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
        transition={comicSpring}
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-magenta"
          animate={reduced ? undefined : { x: [0, 8, 0], y: [0, -6, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -bottom-8 -left-6 h-28 w-28 rounded-full bg-cyan"
          animate={reduced ? undefined : { x: [0, -6, 0], y: [0, 8, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        />
        <p className="relative font-sans text-[11px] font-extrabold uppercase tracking-[0.35em]">
          Private group clipboard
        </p>
        <h1 className="relative mt-2 font-display text-6xl font-black italic leading-none tracking-tight sm:text-7xl">
          Copywall
        </h1>
        <p className="relative mt-3 max-w-sm font-sans text-sm font-medium leading-relaxed">
          Share code, links, and files with the people in your room. No chat hop.
        </p>
      </motion.div>

      <motion.form
        onSubmit={(event) => void submit(event)}
        className="comic-outline relative z-10 -mt-3 bg-bubble p-5 sm:p-6"
        initial={reduced ? false : { opacity: 0, y: 28, rotate: 3 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ ...comicSpring, delay: reduced ? 0 : 0.12 }}
      >
        <div className="flex gap-2">
          {(["login", "signup"] as const).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              onClick={() => {
                setMode(nextMode);
                setError(null);
                setMessage(null);
              }}
              className={`comic-outline-sm flex-1 px-3 py-2 font-sans text-xs font-extrabold uppercase tracking-widest ${
                mode === nextMode ? "bg-magenta text-bubble" : "bg-paper"
              }`}
            >
              {nextMode === "login" ? "Log in" : "Create account"}
            </button>
          ))}
        </div>

        {mode === "signup" ? (
          <label className="mt-5 block font-sans text-xs font-extrabold uppercase tracking-widest">
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              maxLength={48}
              placeholder="The name your room sees"
              className="mt-1 w-full comic-outline-sm bg-paper px-3 py-2.5 font-sans text-base font-semibold outline-none placeholder:text-ink/35"
            />
          </label>
        ) : null}

        <label className="mt-5 block font-sans text-xs font-extrabold uppercase tracking-widest">
          Email
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
            type="email"
            placeholder="you@college.edu"
            className="mt-1 w-full comic-outline-sm bg-paper px-3 py-2.5 font-sans text-base font-semibold outline-none placeholder:text-ink/35"
          />
        </label>

        <label className="mt-3 block font-sans text-xs font-extrabold uppercase tracking-widest">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            placeholder="At least 8 characters"
            className="mt-1 w-full comic-outline-sm bg-paper px-3 py-2.5 font-sans text-base font-semibold outline-none placeholder:text-ink/35"
          />
        </label>

        {error ? (
          <motion.p
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: [0, -4, 4, -2, 0] }}
            className="mt-3 comic-outline-sm bg-punch px-3 py-2 text-sm font-bold text-bubble"
          >
            {error}
          </motion.p>
        ) : null}
        {message ? (
          <p className="mt-3 comic-outline-sm bg-cyan px-3 py-2 text-sm font-bold">{message}</p>
        ) : null}

        <motion.button
          type="submit"
          disabled={submitting}
          className="mt-4 w-full comic-outline bg-magenta px-4 py-3 font-display text-2xl font-black italic text-bubble disabled:opacity-60"
          whileHover={submitting ? undefined : tapPress.whileHover}
          whileTap={submitting ? undefined : tapPress.whileTap}
        >
          {submitting ? "Opening..." : mode === "login" ? "Enter Copywall" : "Make my account"}
        </motion.button>
      </motion.form>
    </div>
  );
}
