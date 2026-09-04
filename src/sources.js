// Three audio sources, tried in order. Each returns a URL for (reciter, surahNumber).
//   1. mp3quran.net      – ~240 reciters, live API
//   2. quranicaudio.com  – ~175 reciters, live API
//   3. cdn.islamic.network (alquran.cloud) – ~15 reciters, static list
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const UA = "Mozilla/5.0 (quran-cli)";
const pad3 = (n) => String(n).padStart(3, "0");

export const SOURCES = [
  {
    id: "mp3quran",
    label: "mp3quran.net",
    url: (r, n) => `${r.mp3quran}${pad3(n)}.mp3`,
  },
  {
    id: "quranicaudio",
    label: "quranicaudio.com",
    url: (r, n) => `https://download.quranicaudio.com/quran/${r.quranicaudio}${pad3(n)}.mp3`,
  },
  {
    id: "islamic",
    label: "cdn.islamic.network",
    url: (r, n) => `https://cdn.islamic.network/quran/audio-surah/128/${r.islamic}/${n}.mp3`,
  },
];

// Static list for source 3 (verse-by-verse editions that also expose full-surah files).
const ISLAMIC_NETWORK = {
  "ar.alafasy": "Mishary Rashid Alafasy",
  "ar.abdurrahmaansudais": "Abdurrahman As-Sudais",
  "ar.abdulsamad": "Abdul Basit Abdul Samad",
  "ar.shaatree": "Abu Bakr Ash-Shaatree",
  "ar.ahmedajamy": "Ahmed ibn Ali al-Ajamy",
  "ar.hanirifai": "Hani Ar-Rifai",
  "ar.husary": "Mahmoud Khalil Al-Husary",
  "ar.husarymujawwad": "Mahmoud Khalil Al-Husary (Mujawwad)",
  "ar.hudhaify": "Ali Al-Hudhaify",
  "ar.ibrahimakhbar": "Ibrahim Al-Akhdar",
  "ar.mahermuaiqly": "Maher Al Muaiqly",
  "ar.muhammadayyoub": "Muhammad Ayyoub",
  "ar.muhammadjibreel": "Muhammad Jibreel",
  "ar.saoodshuraym": "Saud Ash-Shuraym",
  "ar.abdullahbasfar": "Abdullah Basfar",
  "ar.aymanswoaid": "Ayman Sowaid",
};

import { nameTokens, normalizeName, sameReciter } from "./names.js";
export { normalizeName };

const isPlain = (label) =>
  !/mujawwad|translation|taraweeh|tarawee|with |dua|ramadan|\d{4}|sudais and/i.test(label);

// ---- fetchers -----------------------------------------------------------------------
async function getJSON(url, timeoutMs = 12000) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchMp3Quran() {
  const d = await getJSON("https://mp3quran.net/api/v3/reciters?language=eng");
  const out = [];
  for (const r of d.reciters) {
    // Prefer the full Hafs/Murattal mushaf with all 114 surahs.
    const m =
      r.moshaf.find((m) => m.surah_total === 114 && /hafs/i.test(m.name) && /murattal/i.test(m.name)) ||
      r.moshaf.find((m) => m.surah_total === 114) ||
      r.moshaf[0];
    if (!m) continue;
    out.push({
      name: r.name.trim(),
      mp3quran: m.server.endsWith("/") ? m.server : m.server + "/",
      surahs: m.surah_list.split(",").map(Number),
    });
  }
  return out;
}

async function fetchQuranicAudio() {
  const d = await getJSON("https://quranicaudio.com/api/qaris");
  return d
    .filter((q) => q.file_formats === "mp3" && isPlain(q.name))
    .map((q) => ({ name: q.name.trim(), arabic: q.arabic_name, quranicaudio: q.relative_path }));
}

function islamicList() {
  return Object.entries(ISLAMIC_NETWORK).map(([id, name]) => ({ name, islamic: id }));
}

// ---- merge ----------------------------------------------------------------------------
export function mergeReciters(lists) {
  const merged = [];
  for (const list of lists) {
    for (const r of list) {
      const toks = nameTokens(r.name);
      const ex = merged.find((m) => sameReciter(m._toks, toks));
      if (ex) {
        for (const k of ["mp3quran", "quranicaudio", "islamic", "arabic", "surahs"]) if (!ex[k] && r[k]) ex[k] = r[k];
      } else merged.push({ ...r, _toks: toks });
    }
  }
  return merged
    .map(({ _toks, sources, ...r }) => ({ ...r, sources: SOURCES.filter((s) => r[s.id]).map((s) => s.id) }))
    .sort((a, b) => b.sources.length - a.sources.length || a.name.localeCompare(b.name));
}

export async function loadReciters({ log = () => {} } = {}) {
  const results = await Promise.allSettled([fetchMp3Quran(), fetchQuranicAudio()]);
  const lists = [];
  results.forEach((res, i) => {
    const label = ["mp3quran.net", "quranicaudio.com"][i];
    if (res.status === "fulfilled") lists.push(res.value);
    else log(`warn: could not load reciters from ${label} (${res.reason.message})`);
  });
  lists.push(islamicList());
  let merged = mergeReciters(lists);
  if (lists.length < 3) {
    // Fill any gap from the bundled snapshot so every source stays available offline.
    try {
      const snap = JSON.parse(await readFile(snapshotPath(), "utf8"));
      merged = mergeReciters([merged, snap]);
      log("info: using bundled reciter snapshot for the unavailable source");
    } catch {}
  }
  return merged;
}

export function snapshotPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "reciters.json");
}

export const _internal = { fetchMp3Quran, fetchQuranicAudio, islamicList };
