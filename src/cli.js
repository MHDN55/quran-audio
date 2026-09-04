import { search, select, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import cliProgress from "cli-progress";
import path from "node:path";
import os from "node:os";
import { SURAHS } from "./surahs.js";
import { loadReciters } from "./sources.js";
import { downloadSurah } from "./download.js";
import { play, findTerminalPlayer } from "./play.js";

const fold = (s) => s.toLowerCase().replace(/[`'’\-]/g, "").replace(/\s+/g, " ");
const matches = (hay, q) => {
  const h = fold(hay);
  return fold(q).split(" ").filter(Boolean).every((w) => h.includes(w));
};

// Legacy Windows console (cmd.exe / conhost) cannot shape or right-to-left render Arabic,
// so Arabic labels are hidden there unless --arabic is passed. Windows Terminal (WT_SESSION) is fine.
function canRenderArabic() {
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

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(`quran – download Quran MP3 recitations

  quran [-o <folder>] [--arabic | --no-arabic]

  -o, --out    download folder (default: ${opts.out})
  --arabic     show Arabic names (hidden automatically in the legacy Windows console,
               which cannot render Arabic; use Windows Terminal for proper display)`);
    return;
  }

  console.log(chalk.green.bold("\n  Quran CLI") + chalk.dim("  ·  mp3quran.net → quranicaudio.com → cdn.islamic.network\n"));

  // 1. Surah
  const surahChoices = [
    { name: chalk.bold("★ All 114 surahs"), value: "all", description: "Download the full Quran for one reciter" },
    ...SURAHS.map((s) => ({
      name: `${String(s.number).padStart(3, " ")}  ${s.name.padEnd(16)}${opts.arabic ? " " + s.arabic : ""}`,
      value: s.number,
    })),
  ];
  const surahPick = await search({
    message: "Surah (type to search):",
    pageSize: 15,
    source: (input) =>
      !input
        ? surahChoices
        : surahChoices.filter((c) => {
            if (c.value === "all") return matches("all 114", input);
            const s = SURAHS[c.value - 1];
            return matches(`${s.number} ${s.name} ${s.arabic} ${s.keywords}`, input);
          }),
  });
  const surahs = surahPick === "all" ? SURAHS : [SURAHS[surahPick - 1]];

  // 2. Reciter
  process.stdout.write(chalk.dim("  loading reciters…"));
  const reciters = await loadReciters({ log: (m) => console.log("\n  " + chalk.yellow(m)) });
  process.stdout.write(`\r  ${chalk.dim(`${reciters.length} reciters available`)}\n`);

  const eligible = reciters.filter((r) =>
    surahPick === "all" ? true : !r.surahs || r.surahs.includes(surahPick)
  );
  const reciterChoices = eligible.map((r) => ({
    name: `${r.name}${opts.arabic && r.arabic ? chalk.dim("  " + r.arabic) : ""}  ${chalk.dim(`[${r.sources.length} source${r.sources.length > 1 ? "s" : ""}]`)}`,
    value: r,
  }));
  const reciter = await search({
    message: "Reciter (type to search):",
    pageSize: 15,
    source: (input) =>
      !input ? reciterChoices : reciterChoices.filter((c) => matches(`${c.value.name} ${c.value.arabic || ""}`, input)),
  });

  // 3. Confirm & download
  const outDir = path.join(opts.out, reciter.name.replace(/[\/:*?"<>|]+/g, ""));
  const what = surahPick === "all" ? "all 114 surahs" : `surah ${surahs[0].number} ${surahs[0].name}`;
  console.log(`\n  ${chalk.cyan(what)} by ${chalk.cyan(reciter.name)}`);
  console.log(`  sources: ${reciter.sources.join(" → ")}`);
  console.log(`  folder:  ${outDir}\n`);
  const player = findTerminalPlayer();
  const action = await select({
    message: "Ready?",
    choices: [
      { name: "Run download", value: "run" },
      {
        name: "Play",
        value: "play",
        description: player
          ? `download if needed, then play in the terminal with ${player.bin}`
          : "download if needed, then open in your default music player",
      },
      { name: "Cancel", value: "cancel" },
    ],
  });
  if (action === "cancel") return;

  const bar = new cliProgress.SingleBar(
    { format: "  {surah} |{bar}| {percentage}% {size}", hideCursor: true, clearOnComplete: true, barsize: 30 },
    cliProgress.Presets.shades_classic
  );

  let ok = 0, skipped = 0;
  const failed = [];
  const files = [];
  for (const s of surahs) {
    const label = `${String(s.number).padStart(3, "0")} ${s.name}`.padEnd(20);
    bar.start(100, 0, { surah: label, size: "" });
    try {
      const r = await downloadSurah({
        reciter, surah: s, outDir,
        onProgress: (done, total) =>
          bar.update(total ? Math.round((done / total) * 100) : 0, { size: `${(done / 1e6).toFixed(1)} MB` }),
        onFallback: (src, msg) => { bar.stop(); console.log(chalk.yellow(`  ${label} ${src} failed (${msg}) → trying next source`)); bar.start(100, 0, { surah: label, size: "" }); },
      });
      bar.stop();
      files.push(r.file);
      if (r.skipped) { skipped++; console.log(chalk.dim(`  ${label} already downloaded`)); }
      else { ok++; console.log(chalk.green(`  ✓ ${label}`) + chalk.dim(` ← ${r.source}`)); }
    } catch (e) {
      bar.stop();
      failed.push(s);
      console.log(chalk.red(`  ✗ ${label} ${e.message}`));
    }
  }

  console.log(`\n  ${chalk.green(`${ok} downloaded`)}${skipped ? chalk.dim(`, ${skipped} already present`) : ""}${failed.length ? chalk.red(`, ${failed.length} failed`) : ""}`);
  console.log(`  ${chalk.dim(outDir)}\n`);
  if (action === "play" && files.length) {
    console.log(chalk.dim(player ? "  playing… (press q to stop)\n" : "  opening in your music player…\n"));
    try { await play(files, { dir: outDir }); }
    catch (e) { console.log(chalk.red(`  could not start player: ${e.message}`)); }
  }
  if (surahs.length === 1 && !failed.length) {
    const again = await confirm({ message: "Another surah?", default: false }).catch(() => false);
    if (again) return main(argv);
  }
}
