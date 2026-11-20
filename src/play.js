// Plays MP3 files. Prefers a terminal player (works over SSH / in Termux), otherwise hands
// the file to the operating system's default audio player.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

// Network options for mpv. Long surahs are 100-250 MB: mpv fills its read-ahead cache and
// then leaves the HTTP connection idle for many minutes, and a NAT/CDN silently drops it.
// By default ffmpeg then blocks forever on the dead socket and playback "stops" once the
// cache runs out (always at the same spot). So: a smaller cache that keeps the socket busy,
// a read timeout, and automatic reconnect (Range request) from where it stopped.
export const MPV_NET_ARGS = [
  "--cache=yes", "--demuxer-max-bytes=32MiB", "--demuxer-max-back-bytes=16MiB",
  "--network-timeout=10",
  "--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=5",
];

const TERMINAL_PLAYERS = [
  {
    bin: "mpv",
    // --quiet keeps the live status line (time / duration) and terminal key controls.
    args: (files) => [
      "--no-video", "--quiet", "--term-osd-bar", "--input-terminal=yes", ...MPV_NET_ARGS,
      "--term-status-msg=  ${?pause==yes:⏸ paused }${time-pos} / ${duration}   [${playlist-pos-1}/${playlist-count}]",
      ...files,
    ],
    controls: "SPACE pause/resume   ←/→ seek 5s   ↑/↓ seek 1min   >/< next/prev surah   q stop",
  },
  {
    bin: "mpg123",
    args: (files) => ["-C", ...files],   // -C enables terminal control keys
    controls: "SPACE pause/resume   f next surah   d previous   q stop",
  },
  {
    bin: "ffplay",
    args: (files) => ["-nodisp", "-autoexit", "-loglevel", "quiet", files[0]],
    single: true,
    controls: "Ctrl+C stop   (ffplay cannot pause without a window – install mpv for pause/resume)",
  },
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
