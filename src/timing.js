// Per-ayah timings from mp3quran.net (available for ~100 of its reciters).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const UA = "Mozilla/5.0 (quran-cli)";
const dataFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "timing-reads.json");
let readsPromise;

async function getJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** folder_url -> read id, live with bundled fallback. */
function loadReads() {
  if (!readsPromise) {
    readsPromise = getJSON("https://mp3quran.net/api/v3/ayat_timing/reads")
      .then((arr) => Object.fromEntries(arr.map((r) => [r.folder_url.replace(/\/$/, "") + "/", r.id])))
      .catch(async () => JSON.parse(await readFile(dataFile, "utf8")));
  }
  return readsPromise;
}

/** Returns the mp3quran timing "read" id for a reciter, or null if no timings exist. */
export async function timingReadId(reciter) {
  if (!reciter.mp3quran) return null;
  const reads = await loadReads().catch(() => ({}));
  return reads[reciter.mp3quran.replace(/\/$/, "") + "/"] ?? null;
}

/**
 * Ayah timings for one surah: [{ ayah, start, end }] in seconds, sorted, ayah 0 = basmalah/intro.
 * Returns null when unavailable.
 */
export async function ayahTimings(readId, surahNumber) {
  if (!readId) return null;
  try {
    const arr = await getJSON(`https://mp3quran.net/api/v3/ayat_timing?surah=${surahNumber}&read=${readId}`);
    const t = arr
      .map((a) => ({ ayah: a.ayah, start: a.start_time / 1000, end: a.end_time / 1000 }))
      .filter((a) => Number.isFinite(a.start))
      .sort((a, b) => a.start - b.start);
    return t.length ? t : null;
  } catch {
    return null;
  }
}

export function ayahAt(timings, t) {
  if (!timings) return null;
  let cur = null;
  for (const a of timings) { if (t + 0.05 >= a.start) cur = a; else break; }
  return cur;
}
