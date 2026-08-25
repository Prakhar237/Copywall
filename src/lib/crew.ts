export const CREW = ["Prakhar", "Arhem", "Nipun", "Gokul"] as const;
export type CrewName = (typeof CREW)[number];

export const ADMIN_NAME: CrewName = "Prakhar";
export const BOARD_PASS = "1234";
export const SESSION_KEY = "copywall-session";
export const RIP_WINDOW_MS = 15_000;

export function canonicalizeName(raw: string): CrewName | null {
  const needle = raw.trim().toLowerCase();
  return CREW.find((name) => name.toLowerCase() === needle) ?? null;
}

export function isAdmin(name: string) {
  return name === ADMIN_NAME;
}

export function isOwnClip(authorName: string, sessionName: string) {
  return authorName.trim().toLowerCase() === sessionName.trim().toLowerCase();
}

export function canRipClip(
  authorName: string,
  createdAt: string,
  sessionName: string,
  now: number,
) {
  if (isAdmin(sessionName)) return true;
  if (!isOwnClip(authorName, sessionName)) return false;
  return now - new Date(createdAt).getTime() < RIP_WINDOW_MS;
}

export function ripSecondsLeft(createdAt: string, now: number) {
  const left = RIP_WINDOW_MS - (now - new Date(createdAt).getTime());
  return Math.max(0, Math.ceil(left / 1000));
}
