"use client";

import { FormEvent, useState } from "react";
import { BOARD_PASS, CREW, CrewName, canonicalizeName } from "@/lib/crew";

type Props = {
  onEnter: (name: CrewName) => void;
};

export default function LoginGate({ onEnter }: Props) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      <div className="comic-outline relative overflow-hidden bg-yellow px-6 py-7 sm:px-8">
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-magenta" />
        <div className="pointer-events-none absolute -bottom-8 -left-6 h-28 w-28 rounded-full bg-cyan" />
        <p className="relative font-sans text-[11px] font-extrabold uppercase tracking-[0.35em]">
          Members only
        </p>
        <h1 className="relative mt-2 font-display text-6xl font-black italic leading-none tracking-tight sm:text-7xl">
          Copywall
        </h1>
        <p className="relative mt-3 max-w-sm font-sans text-sm font-medium leading-relaxed">
          Four names. One pass. Then the wall.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="comic-outline relative z-10 -mt-3 bg-bubble p-5 sm:p-6"
      >
        <p className="font-sans text-[11px] font-extrabold uppercase tracking-[0.22em] text-ink/70">
          Pick your desk
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {CREW.map((crew) => {
            const active = canonicalizeName(name) === crew;
            return (
              <button
                key={crew}
                type="button"
                onClick={() => {
                  setName(crew);
                  setError(null);
                }}
                className={`comic-outline-sm px-3 py-1.5 font-sans text-xs font-extrabold uppercase tracking-widest ${
                  active ? "bg-magenta text-bubble" : "bg-paper"
                }`}
              >
                {crew}
              </button>
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
          <p className="mt-3 comic-outline-sm bg-punch px-3 py-2 text-sm font-bold text-bubble">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="mt-4 w-full comic-outline bg-magenta px-4 py-3 font-display text-2xl font-black italic text-bubble transition-transform hover:-translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-none"
        >
          Enter the wall
        </button>
      </form>
    </div>
  );
}
