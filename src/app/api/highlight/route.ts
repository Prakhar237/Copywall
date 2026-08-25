import { NextResponse } from "next/server";
import { highlightCode } from "@/lib/highlight";
import { normalizeLang } from "@/lib/detect-code";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { code?: unknown }).code !== "string"
  ) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const code = (body as { code: string }).code;
  const lang = normalizeLang(
    typeof (body as { lang?: unknown }).lang === "string"
      ? (body as { lang: string }).lang
      : "plaintext",
  );

  if (!code || code.length > 20000) {
    return NextResponse.json({ error: "Code too long" }, { status: 400 });
  }

  const html = await highlightCode(code, lang);
  return NextResponse.json({ html, lang });
}
