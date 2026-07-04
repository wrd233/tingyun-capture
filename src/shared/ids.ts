import { randomUUID } from "node:crypto";

export class IdSequence {
  private counters = new Map<string, number>();

  next(prefix: string): string {
    const value = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, value);
    return `${prefix}-${String(value).padStart(4, "0")}`;
  }
}

export function newSessionId(): string {
  return `session-${randomUUID()}`;
}
