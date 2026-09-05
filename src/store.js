// Small persistent state in ~/.quran-audio/: recent plays (max 5).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = path.join(os.homedir(), ".quran-audio");
const recentPath = path.join(dir, "recent.json");
export const RECENT_MAX = 5;

export async function loadRecent() {
  try {
    const arr = JSON.parse(await readFile(recentPath, "utf8"));
    return Array.isArray(arr) ? arr.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * entry: { surah: number | "all", reciter: <reciter object> }
 * Same surah+reciter moves to the top; the list is capped at RECENT_MAX.
 */
export async function pushRecent(entry) {
  const list = await loadRecent();
  const same = (e) => e.surah === entry.surah && e.reciter?.name === entry.reciter?.name;
  const next = [{ ...entry, at: Date.now() }, ...list.filter((e) => !same(e))].slice(0, RECENT_MAX);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(recentPath, JSON.stringify(next, null, 1));
  } catch {}
  return next;
}
