import fs from "node:fs";
import path from "node:path";

export class JsonlWriter<T> {
  constructor(private readonly filePath: string) {}

  async append(record: T): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await fs.promises.appendFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const text = await fs.promises.readFile(filePath, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
