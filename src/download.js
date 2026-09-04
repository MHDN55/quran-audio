import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { SOURCES } from "./sources.js";

const UA = "Mozilla/5.0 (quran-cli)";

export function safeName(s) {
  return s.replace(/[\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
}

async function fetchStream(url, onProgress, timeoutMs = 20000) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (/text\/html/i.test(ct)) throw new Error("got HTML instead of audio");
  const total = Number(res.headers.get("content-length")) || 0;
  let done = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (c) => { done += c.length; onProgress?.(done, total); });
  return { body, total };
}

/**
 * Download one surah for a reciter, trying every source the reciter has, in order.
 * Returns { file, source } on success; throws with all attempts listed on failure.
 */
export async function downloadSurah({ reciter, surah, outDir, onProgress, onFallback }) {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${String(surah.number).padStart(3, "0")} - ${safeName(surah.name)}.mp3`);
  try {
    const st = await stat(file);
    if (st.size > 10_000) return { file, source: "cached", skipped: true };
  } catch {}

  const errors = [];
  for (const src of SOURCES) {
    if (!reciter[src.id]) continue;
    const url = src.url(reciter, surah.number);
    const tmp = file + ".part";
    try {
      const { body } = await fetchStream(url, onProgress);
      await pipeline(body, createWriteStream(tmp));
      const st = await stat(tmp);
      if (st.size < 10_000) throw new Error("file too small");
      await rename(tmp, file);
      return { file, source: src.label, url };
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {});
      errors.push(`${src.label}: ${e.message}`);
      onFallback?.(src.label, e.message);
    }
  }
  throw new Error(`all sources failed for surah ${surah.number}:\n  ` + errors.join("\n  "));
}
