import { codeToHtml } from "shiki";

const FALLBACK_LANG = "plaintext";

export async function highlightCode(code: string, lang: string): Promise<string> {
  const theme = "catppuccin-latte";
  try {
    return await codeToHtml(code, {
      lang,
      theme,
    });
  } catch {
    return codeToHtml(code, {
      lang: FALLBACK_LANG,
      theme,
    });
  }
}
