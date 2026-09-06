"use client";

import { useEffect, useState } from "react";
import { FILE_BUCKET, fileKindLabel, formatBytes } from "@/lib/files";
import { supabase } from "@/lib/supabase";

type Props = {
  fileName: string;
  filePath: string;
  fileSize: number | null;
  mimeType: string | null;
};

export default function ClipFile({
  fileName,
  filePath,
  fileSize,
  mimeType,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const kind = fileKindLabel(fileName, mimeType);
  const isImage = Boolean(
    mimeType?.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName),
  );

  useEffect(() => {
    let active = true;
    void supabase.storage
      .from(FILE_BUCKET)
      .createSignedUrl(filePath, 60 * 30)
      .then(({ data }) => {
        if (active) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      active = false;
    };
  }, [filePath]);

  return (
    <div className="mt-3">
      <span className="stamp comic-outline-sm bg-ink px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-yellow">
        File
      </span>
      {isImage && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={fileName}
          className="mt-2 max-h-48 w-full comic-outline-sm object-contain bg-paper"
        />
      ) : null}
      <a
        href={url ?? "#"}
        download={fileName}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          if (!url) event.preventDefault();
        }}
        className="mt-2 flex items-center justify-between gap-3 comic-outline-sm bg-paper px-3 py-2 no-underline"
      >
        <span className="min-w-0">
          <span className="block truncate font-sans text-sm font-bold text-ink">
            {fileName}
          </span>
          <span className="font-sans text-[10px] font-extrabold uppercase tracking-widest text-ink/55">
            {kind}
            {fileSize ? ` · ${formatBytes(fileSize)}` : ""}
          </span>
        </span>
        <span className="shrink-0 font-sans text-[10px] font-extrabold uppercase tracking-widest">
          {url ? "Open" : "Loading..."}
        </span>
      </a>
    </div>
  );
}
