import { search, select, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import cliProgress from "cli-progress";
import path from "node:path";
import os from "node:os";
import { SURAHS } from "./surahs.js";
import { loadReciters } from "./sources.js";
import { downloadSurah, resolveUrl, localFile } from "./download.js";
import { play, findTerminalPlayer } from "./play.js";
import { playInteractive, CONTROLS } from "./player.js";
import { timingReadId, ayahTimings } from "./timing.js";
import { updateNotice } from "./update.js";
import { loadRecent, pushRecent } from "./store.js";

let updateChecked = false;
async function showUpdateNotice(pending) {
  if (updateChecked) return;
  updateChecked = true;
  const notice = await pending.catch(() => null);
  if (notice) console.log("\n" + notice + "\n");
}

const fold = (s) => s.toLowerCase().replace(/[`'’\-]/g, "").replace(/\s+/g, " ");
const matches = (hay, q) => {
  const h = fold(hay);
  return fold(q).split(" ").filter(Boolean).every((w) => h.includes(w));
};
const label = (s) => `${String(s.number).padStart(3, "0")} ${s.name}`;
const safeDir = (name) => name.replace(/[\\/:*?"<>|]+/g, "");

// Legacy Windows console (cmd.exe / conhost) cannot shape or right-to-left render Arabic,
// so Arabic labels are hidden there unless --arabic is passed. Windows Terminal (WT_SESSION) is fine.
function canRenderArabic() {
  // Termux on Android cannot shape / right-to-left render Arabic either.
  if (process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux")) return false;
  if (process.platform !== "win32") return true;
  return Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.WSL_DISTRO_NAME);
}

function parseArgs(argv) {
  const opts = { out: path.join(os.homedir(), "Quran"), arabic: canRenderArabic() };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "-o" || argv[i] === "--out") && argv[i + 1]) opts.out = argv[++i];
    else if (argv[i] === "-h" || argv[i] === "--help") opts.help = true;
    else if (argv[i] === "--arabic") opts.arabic = true;
    else if (argv[i] === "--no-arabic") opts.arabic = false;
  }
  return opts;
}

// ---------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------

/** Returns { surahPick: number|"all", reciter?: object } — reciter is set when a recent entry was chosen. */
async function pickSurah(opts, recent) {
  const recentChoices = recent.map((e, i) => {
    const what = e.surah === "all" ? "All 114 surahs" : SURAHS[e.surah - 1]?.name ?? `Surah ${e.surah}`;
    return {
      name: chalk.magenta("⟳ ") + `${what.padEnd(16)} ${chalk.dim("·")} ${e.reciter.name}`,
      value: { recent: i },
      description: "recent",
      search: `${what} ${e.reciter.name} ${e.reciter.arabic || ""} recent`,
    };
  });
  const all = { name: chalk.bold("★ All 114 surahs"), value: "all", description: "Play or download the full Quran for one reciter", search: "all 114" };
  const surahChoices = SURAHS.map((s) => ({
    name: `${String(s.number).padStart(3, " ")}  ${s.name.padEnd(16)}${opts.arabic ? " " + s.arabic : ""}`,
    value: s.number,
    search: `${s.number} ${s.name} ${s.arabic} ${s.keywords}`,
  }));
  const choices = [...recentChoices, all, ...surahChoices];
  const picked = await search({
    message: recent.length ? "Surah (type to search · ⟳ = recent):" : "Surah (type to search):",
    pageSize: 15,
    source: (input) => (!input ? choices : choices.filter((c) => matches(c.search, input))),
  });
  if (typeof picked === "object") {
    const e = recent[picked.recent];
    return { surahPick: e.surah, reciter: e.reciter };
  }
  return { surahPick: picked };
}

async function pickReciter(opts, surahPick) {
  const reciters = await loadReciters({ log: (m) => console.log("\n  " + chalk.yellow(m)) });
  const eligible = reciters.filter((r) => (surahPick === "all" ? true : !r.surahs || r.surahs.includes(surahPick)));
  const choices = eligible.map((r) => ({
    name: `${r.name}${opts.arabic && r.arabic ? chalk.dim("  " + r.arabic) : ""}  ${chalk.dim(`[${r.sources.length} source${r.sources.length > 1 ? "s" : ""}]`)}`,
    value: r,
  }));
  return search({
    message: "Reciter (type to search):",
    pageSize: 15,
    source: (input) => (!input ? choices : choices.filter((c) => matches(`${c.value.name} ${c.value.arabic || ""}`, input))),
  });
}

// ---------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------

async function doDownload({ reciter, surahs, outDir }) {
  const bar = new cliProgress.SingleBar(
    { format: "  {surah} |{bar}| {percentage}% {size}", hideCursor: true, clearOnComplete: true, barsize: 30 },
    cliProgress.Presets.shades_classic
  );
  let ok = 0, skipped = 0;
  const failed = [];
  for (const s of surahs) {
    const l = label(s).padEnd(20);
    bar.start(100, 0, { surah: l, size: "" });
    try {
      const r = await downloadSurah({
        reciter, surah: s, outDir,
        onProgress: (done, total) => bar.update(total ? Math.round((done / total) * 100) : 0, { size: `${(done / 1e6).toFixed(1)} MB` }),
        onFallback: (src, msg) => { bar.stop(); console.log(chalk.yellow(`  ${l} ${src} failed (${msg}) → trying next source`)); bar.start(100, 0, { surah: l, size: "" }); },
      });
      bar.stop();
      if (r.skipped) { skipped++; console.log(chalk.dim(`  ${l} already downloaded`)); }
      else { ok++; console.log(chalk.green(`  ✓ ${l}`) + chalk.dim(` ← ${r.source}`)); }
    } catch (e) {
      bar.stop();
      failed.push(s);
      console.log(chalk.red(`  ✗ ${l} ${e.message}`));
    }
  }
  console.log(`\n  ${chalk.green(`${ok} downloaded`)}${skipped ? chalk.dim(`, ${skipped} already present`) : ""}${failed.length ? chalk.red(`, ${failed.length} failed`) : ""}`);
  console.log(`  ${chalk.dim(outDir)}\n`);
  return failed.length === 0;
}

/**
 * Play: local files are used when present (works offline); everything else is streamed.
 * With save=true, streamed surahs are downloaded in the background at the same time.
 */
async function doPlay({ reciter, surahs, outDir, save, player }) {
  // Resolve each surah to a local file or a stream URL (concurrently).
  if (surahs.length > 1) process.stdout.write(chalk.dim("  checking local files and sources for 114 surahs…"));
  const tracks = (await Promise.all(surahs.map(async (s) => {
    const file = await localFile(outDir, s);
    if (file) return { surah: s, url: file, source: "local", local: true };
    return resolveUrl({
      reciter, surah: s,
      onFallback: (src, msg) => console.log(chalk.yellow(`\n  ${label(s)} ${src} failed (${msg}) → trying next source`)),
    }).then((r) => ({ surah: s, ...r })).catch((e) => { console.log(chalk.red(`\n  ✗ ${label(s)} ${e.message}`)); return null; });
  }))).filter(Boolean);
  if (surahs.length > 1) process.stdout.write("\r" + " ".repeat(60) + "\r");
  if (!tracks.length) return;

  const localCount = tracks.filter((t) => t.local).length;
  if (surahs.length === 1) {
    console.log(tracks[0].local ? chalk.green("  playing from local file (offline)") : chalk.dim(`  streaming from ${tracks[0].source}`));
  } else {
    console.log(chalk.dim(`  ${localCount} local, ${tracks.length - localCount} streamed`));
  }

  // Background save of the streamed surahs, sequential so it does not starve the stream.
  let saving = Promise.resolve({ saved: 0, failed: 0 });
  const toSave = save ? tracks.filter((t) => !t.local) : [];
  if (toSave.length) {
    console.log(chalk.dim(`  saving ${toSave.length} surah${toSave.length > 1 ? "s" : ""} to ${outDir} while playing`));
    saving = (async () => {
      let saved = 0, failed = 0;
      for (const t of toSave) {
        try { await downloadSurah({ reciter, surah: t.surah, outDir }); saved++; } catch { failed++; }
      }
      return { saved, failed };
    })();
  }

  const urls = tracks.map((t) => t.url);
  if (player?.bin === "mpv") {
    // Ayah timings exist for mp3quran reciters; local files were downloaded from that source first.
    const useTimings = tracks.some((t) => t.local || t.source === "mp3quran.net");
    const readId = useTimings ? await timingReadId(reciter) : null;
    if (!readId) console.log(chalk.dim("  (no ayah timings for this reciter/source – ayah keys seek 5s instead)"));
    console.log("  " + chalk.cyan(CONTROLS) + "\n");
    try {
      await playInteractive(tracks.map((t) => ({
        url: t.url, surah: t.surah,
        timings: readId && (t.local || t.source === "mp3quran.net") ? () => ayahTimings(readId, t.surah.number) : null,
      })));
    } catch (e) {
      console.log(chalk.yellow(`  interactive player unavailable (${e.message}), using plain mpv`));
      await play(urls).catch((e) => console.log(chalk.red(`  could not start player: ${e.message}`)));
    }
  } else {
    if (player) console.log(chalk.dim(`  playing with ${player.bin}\n  `) + chalk.cyan(player.controls) + "\n");
    else console.log(chalk.dim("  opening in your default player…\n"));
    try { await play(urls); } catch (e) { console.log(chalk.red(`  could not start player: ${e.message}`)); }
  }

  if (toSave.length) {
    process.stdout.write(chalk.dim("  finishing background save…"));
    const { saved, failed } = await saving;
    process.stdout.write("\r" + " ".repeat(40) + "\r");
    console.log(saved ? chalk.green(`  ✓ saved ${saved} surah${saved > 1 ? "s" : ""} to ${outDir}`) : "");
    if (failed) console.log(chalk.red(`  ✗ ${failed} could not be saved`));
  }
}

// ---------------------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(`quran – play, stream or download Quran MP3 recitations

  quran [-o <folder>] [--arabic | --no-arabic]

  -o, --out    download folder (default: ${opts.out})
  --arabic     show Arabic names (hidden automatically in terminals that cannot render
               Arabic: the legacy Windows console and Termux)
  --no-arabic  hide Arabic names`);
    return;
  }

  console.log(chalk.green.bold("\n  Quran CLI") + chalk.dim("  ·  mp3quran.net → quranicaudio.com → cdn.islamic.network\n"));
  const pendingUpdate = updateChecked ? Promise.resolve(null) : updateNotice(); // runs in the background

  // 1. Surah (recent plays first)
  const recent = await loadRecent();
  const picked = await pickSurah(opts, recent);
  const surahPick = picked.surahPick;
  const surahs = surahPick === "all" ? SURAHS : [SURAHS[surahPick - 1]];

  // 2. Reciter (skipped when a recent entry was chosen)
  let reciter = picked.reciter;
  if (!reciter) {
    process.stdout.write(chalk.dim("  loading reciters…"));
    reciter = await pickReciter(opts, surahPick);
  }
  await showUpdateNotice(pendingUpdate);

  // 3. Action
  const outDir = path.join(opts.out, safeDir(reciter.name));
  const what = surahPick === "all" ? "all 114 surahs" : `surah ${surahs[0].number} ${surahs[0].name}`;
  const localCount = (await Promise.all(surahs.map((s) => localFile(outDir, s)))).filter(Boolean).length;
  console.log(`\n  ${chalk.cyan(what)} by ${chalk.cyan(reciter.name)}`);
  console.log(`  sources: ${reciter.sources.join(" → ")}${localCount ? chalk.green(`   ·  ${localCount}/${surahs.length} available offline`) : ""}`);
  console.log(`  folder:  ${outDir}\n`);

  const player = findTerminalPlayer();
  const allLocal = localCount === surahs.length;
  const action = await select({
    message: "Ready?",
    choices: [
      { name: "Play", value: "play", description: allLocal ? "play from local files (offline)" : "stream now, nothing is saved (local files are used when present)" },
      ...(allLocal ? [] : [{ name: "Play and save", value: "playsave", description: "stream now and download to the folder at the same time" }]),
      { name: "Download", value: "download", description: "download only" },
      { name: "Cancel", value: "cancel" },
    ],
  });
  if (action === "cancel") return;
  await pushRecent({ surah: surahPick, reciter });

  if (action === "download") await doDownload({ reciter, surahs, outDir });
  else await doPlay({ reciter, surahs, outDir, save: action === "playsave", player });

  const again = await confirm({ message: "Another surah?", default: false }).catch(() => false);
  if (again) return main(argv);
}
