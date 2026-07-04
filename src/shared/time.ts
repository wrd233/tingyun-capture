export function nowIso(): string {
  return new Date().toISOString();
}

export function durationMs(startIso: string, endIso = nowIso()): number {
  return Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
}
