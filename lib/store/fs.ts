import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Backend } from "@/lib/store/backend";

const DATA_DIR = path.join(process.cwd(), "data", "games");

/**
 * Local-development adapter: one JSON file per game, holding the same flat
 * field map the Redis hash holds. Writes go through a per-game promise chain
 * and a temp-file rename so a crash cannot leave a half-written game.
 */
export function fsBackend(): Backend {
  const locks = new Map<string, Promise<unknown>>();

  const serialize = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const next = (locks.get(key) ?? Promise.resolve()).then(task, task);
    locks.set(
      key,
      next.catch(() => {}),
    );
    return next;
  };

  const fileFor = (key: string) => path.join(DATA_DIR, `${key.replace(/[^\w-]/g, "_")}.json`);

  const read = async (key: string): Promise<Record<string, string> | null> => {
    try {
      return JSON.parse(await readFile(fileFor(key), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };

  return {
    readAll: (key) => serialize(key, () => read(key)),

    write: (key, fields, remove = []) =>
      serialize(key, async () => {
        await mkdir(DATA_DIR, { recursive: true });
        const current = (await read(key)) ?? {};
        for (const field of remove) delete current[field];
        Object.assign(current, fields);

        const target = fileFor(key);
        const temp = `${target}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(current, null, 2), "utf8");
        await rename(temp, target);
      }),

    exists: async (key) => (await serialize(key, () => read(key))) !== null,
  };
}
