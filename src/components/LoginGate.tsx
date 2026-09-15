"use client";

import { FormEvent, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BOARD_PASS, CREW, CrewName, canonicalizeName } from "@/lib/crew";
import { comicSpring, tapPress } from "@/lib/motion";

type Props = {
  onEnter: (name: CrewName) => void;
};

export default function LoginGate({ onEnter }: Props) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion();

  function submit(event: FormEvent) {
    event.preventDefault();
    const crew = canonicalizeName(name);
    if (!crew) {
      setError("Name has to be Prakhar, Arhem, Nipun, or Gokul.");
      return;
    }
    if (password !== BOARD_PASS) {
      setError("Wrong pass. Try the crew code.");
      return;
    }
    onEnter(crew);
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
          Members only
        </p>
        <h1 className="relative mt-2 font-display text-6xl font-black italic leading-none tracking-tight sm:text-7xl">
          Copywall
        </h1>
        <p className="relative mt-3 max-w-sm font-sans text-sm font-medium leading-relaxed">
          Four names. One pass. Then the wall.
        </p>
      </motion.div>

      <motion.form
        onSubmit={submit}
        className="comic-outline relative z-10 -mt-3 bg-bubble p-5 sm:p-6"
        initial={reduced ? false : { opacity: 0, y: 28, rotate: 3 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ ...comicSpring, delay: reduced ? 0 : 0.12 }}
      >
        <p className="font-sans text-[11px] font-extrabold uppercase tracking-[0.22em] text-ink/70">
          Pick your desk
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {CREW.map((crew, index) => {
            const active = canonicalizeName(name) === crew;
            return (
              <motion.button
                key={crew}
                type="button"
                onClick={() => {
                  setName(crew);
                  setError(null);
                }}
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...comicSpring, delay: 0.16 + index * 0.05 }}
                whileHover={tapPress.whileHover}
                whileTap={tapPress.whileTap}
                className={`comic-outline-sm px-3 py-1.5 font-sans text-xs font-extrabold uppercase tracking-widest ${
                  active ? "bg-magenta text-bubble" : "bg-paper"
                }`}
              >
                {crew}
              </motion.button>
            );
          })}
        </div>

        <label className="mt-5 block font-sans text-xs font-extrabold uppercase tracking-widest">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="username"
            placeholder="Prakhar, Arhem, Nipun, or Gokul"
            className="mt-1 w-full comic-outline-sm bg-paper px-3 py-2.5 font-sans text-base font-semibold outline-none placeholder:text-ink/35"
          />
        </label>

        <label className="mt-3 block font-sans text-xs font-extrabold uppercase tracking-widest">
          Pass
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Crew code"
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

        <motion.button
          type="submit"
          className="mt-4 w-full comic-outline bg-magenta px-4 py-3 font-display text-2xl font-black italic text-bubble"
          whileHover={tapPress.whileHover}
          whileTap={tapPress.whileTap}
        >
          Enter the wall
        </motion.button>
      </motion.form>
    </div>
  );
}
