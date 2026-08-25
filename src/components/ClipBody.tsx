"use client";

import { useEffect, useState } from "react";
import { inspectClip } from "@/lib/detect-code";

const htmlCache = new Map<string, string>();

export default function ClipBody({ content }: { content: string }) {
  const kind = inspectClip(content);
  const [html, setHtml] = useState<string | null>(
    () => htmlCache.get(`${kind.lang}:${kind.code}`) ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!kind.isCode) return;

    const cacheKey = `${kind.lang}:${kind.code}`;
    const cached = htmlCache.get(cacheKey);
    if (cached) {
      setHtml(cached);
      return;
    }

    let cancelled = false;
    setFailed(false);

    void fetch("/api/highlight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: kind.code, lang: kind.lang }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("highlight failed");
        const data = (await response.json()) as { html?: string };
        if (!data.html) throw new Error("empty html");
        htmlCache.set(cacheKey, data.html);
        if (!cancelled) setHtml(data.html);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [kind.code, kind.isCode, kind.lang]);

  if (!kind.isCode || failed) {
    return (
      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-6">
        {content}
      </pre>
    );
  }

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="stamp comic-outline-sm bg-ink px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-yellow">
          Code
        </span>
        <span className="font-sans text-[10px] font-extrabold uppercase tracking-[0.2em] text-ink/55">
          {kind.lang}
        </span>
      </div>
      {html ? (
        <div
          className="shiki-frame comic-outline-sm max-h-64 overflow-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="comic-outline-sm max-h-64 overflow-auto bg-[#eff1f5] px-3 py-3 font-mono text-[12px] leading-5 text-ink/70">
          Inking syntax...
          {"\n"}
          {kind.code}
        </pre>
      )}
    </div>
  );
}
