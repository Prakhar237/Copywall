const FENCE = /^```([\w.+#-]*)[ \t]*\n([\s\S]*?)\n?```$/;

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  cs: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  cc: "cpp",
  hpp: "cpp",
  rs: "rust",
  kt: "kotlin",
  text: "plaintext",
  txt: "plaintext",
  plain: "plaintext",
};

const KEYWORD_LANGS: Array<{ lang: string; test: RegExp }> = [
  { lang: "html", test: /<\/?[a-zA-Z][\w:-]*[\s>]|<!DOCTYPE/ },
  { lang: "json", test: /^\s*[{\[][\s\S]*[}\]]\s*$/ },
  { lang: "sql", test: /\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|FROM|WHERE)\b/i },
  { lang: "python", test: /\b(def|elif|except|None|True|False|self)\b|^\s*from\s+\w+\s+import\s/m },
  { lang: "rust", test: /\b(fn|let mut|impl|pub struct|match)\b/ },
  { lang: "go", test: /\bpackage\s+\w+|func\s+\w+\(/ },
  { lang: "java", test: /\b(public class|System\.out|void main)\b/ },
  { lang: "kotlin", test: /\b(fun\s+\w+|val\s+\w+|lateinit)\b/ },
  { lang: "swift", test: /\b(func\s+\w+|let\s+\w+\s*=|var\s+\w+\s*:|import Foundation)\b/ },
  { lang: "css", test: /[{;]\s*[a-z-]+\s*:\s*[^;]+;/ },
  { lang: "bash", test: /^#!\/bin\/(ba)?sh\b|^\s*(sudo|apt|brew|npm|yarn|pnpm|git)\s/m },
  { lang: "typescript", test: /\b(interface|type\s+\w+\s*=|:\s*(string|number|boolean)\b)/ },
  { lang: "javascript", test: /\b(const|let|function|=>|import\s+|export\s+|console\.)\b/ },
  { lang: "cpp", test: /#include\s*<|std::|int\s+main\s*\(/ },
  { lang: "c", test: /#include\s*<stdio|printf\s*\(/ },
  { lang: "php", test: /<\?php|\becho\s+/ },
  { lang: "ruby", test: /\b(def\s+\w+|puts\s+|end\s*$)/m },
  { lang: "yaml", test: /^\s*[\w-]+\s*:\s.+\n\s+[\w-]+\s*:/m },
];

export type ClipKind = {
  isCode: boolean;
  lang: string;
  code: string;
};

export function normalizeLang(raw: string | undefined): string {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return "plaintext";
  return LANG_ALIASES[key] ?? key;
}

export function guessLang(source: string): string {
  for (const { lang, test } of KEYWORD_LANGS) {
    if (test.test(source)) return lang;
  }
  return "plaintext";
}

export function looksLikeCode(source: string): boolean {
  const text = source.trim();
  if (!text) return false;
  if (FENCE.test(text)) return true;
  if (/^#!\//.test(text)) return true;

  const lines = text.split(/\n/);
  const joined = text;
  const tokens = (joined.match(/[{}();=<>[\]]/g) ?? []).length;
  const keywords =
    /\b(function|const|let|var|import|export|class|return|def|async|await|public|private|if|else|for|while)\b/.test(
      joined,
    );
  const indented = lines.filter((line) => /^\s{2,}|\t/.test(line)).length;
  const jsonLike = /^\s*[{\[][\s\S]*[}\]]\s*$/.test(text);
  const htmlLike = /<\/?[a-zA-Z][\w:-]*[\s>]/.test(text);
  const density = tokens / Math.max(text.length, 1);

  if (jsonLike && text.length > 8) return true;
  if (htmlLike && (text.includes("</") || text.includes("/>"))) return true;
  if (lines.length >= 2 && (keywords || indented >= 1) && tokens >= 4) return true;
  if (lines.length >= 3 && density > 0.04) return true;
  if (lines.length === 1 && keywords && tokens >= 3 && text.length > 20) return true;
  return false;
}

export function inspectClip(raw: string): ClipKind {
  const trimmed = raw.trim();
  const fenced = trimmed.match(FENCE);
  if (fenced) {
    const code = fenced[2] ?? "";
    const lang = fenced[1] ? normalizeLang(fenced[1]) : guessLang(code);
    return { isCode: true, lang, code };
  }

  const isCode = looksLikeCode(trimmed);
  return {
    isCode,
    lang: isCode ? guessLang(trimmed) : "plaintext",
    code: trimmed,
  };
}
