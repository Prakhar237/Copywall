export const FILE_BUCKET = "wall-files";
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "bat",
  "cmd",
  "com",
  "msi",
  "scr",
  "dll",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "apk",
  "ipa",
  "dmg",
  "app",
  "jar",
]);

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileExtension(name: string) {
  const parts = name.trim().toLowerCase().split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

export function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120) || "file";
}

export function validateWallFile(file: File): string | null {
  if (file.size <= 0) return "That file is empty.";
  if (file.size > MAX_FILE_BYTES) return "Files cap at 50 MB.";
  const ext = fileExtension(file.name);
  if (BLOCKED_EXTENSIONS.has(ext)) return "That file type stays off the wall.";
  return null;
}

export function fileKindLabel(name: string, mime: string | null) {
  const ext = fileExtension(name);
  if (ext) return ext.toUpperCase();
  if (mime?.includes("pdf")) return "PDF";
  if (mime?.includes("sheet") || mime?.includes("excel")) return "XLSX";
  if (mime?.includes("word")) return "DOC";
  if (mime?.includes("presentation") || mime?.includes("powerpoint")) return "PPT";
  return "FILE";
}
