// Plays MP3 files. Prefers a terminal player (works over SSH / in Termux), otherwise hands
// the file to the operating system's default audio player.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const TERMINAL_PLAYERS = [
  { bin: "mpv", args: (files) => ["--no-video", "--really-quiet", "--term-osd-bar", ...files] },
  { bin: "mpg123", args: (files) => ["-q", ...files] },
  { bin: "ffplay", args: (files) => ["-nodisp", "-autoexit", "-loglevel", "quiet", files[0]], single: true },
];

function has(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
  return r.status === 0;
}

export function findTerminalPlayer() {
  return TERMINAL_PLAYERS.find((p) => has(p.bin)) || null;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });
}

/** Play files in order with a terminal player; returns false if none is installed. */
export async function playInTerminal(files) {
  const p = findTerminalPlayer();
  if (!p) return false;
  if (p.single) { for (const f of files) await run(p.bin, p.args([f])); }
  else await run(p.bin, p.args(files));
  return true;
}

/** Open a file (or folder) with the OS default handler. */
export async function openWithSystem(target) {
  if (process.env.TERMUX_VERSION || has("termux-open")) return run("termux-open", [target]);
  if (process.platform === "win32") return run("cmd", ["/c", "start", "", path.resolve(target)], { windowsHide: true });
  if (process.platform === "darwin") return run("open", [target]);
  return run("xdg-open", [target]);
}

/**
 * Stream the given URLs. Uses a terminal player when available (sequential, blocking);
 * otherwise opens the first URL with the system handler (browser / default player), which streams it.
 */
export async function play(urls) {
  if (await playInTerminal(urls)) return { how: findTerminalPlayer().bin };
  await openWithSystem(urls[0]);
  return { how: "system player" };
}
