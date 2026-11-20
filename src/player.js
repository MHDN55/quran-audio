// Interactive streaming player built on mpv's JSON IPC: progress bar with seconds,
// current ayah, and ayah-by-ayah seeking. Falls back to plain mpv when IPC is unavailable.
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import { ayahAt } from "./timing.js";
import { MPV_NET_ARGS } from "./play.js";

// If mpv sits buffering this long with no progress (dead connection that even ffmpeg's
// reconnect could not revive), restart the current track at the same position.
const STALL_SECS = 20;

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ":" : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(sec).padStart(2, "0");
};

function ipcPath() {
  const id = `quran-mpv-${process.pid}-${Date.now()}`;
  return process.platform === "win32" ? "\\\\.\\pipe\\" + id : path.join(os.tmpdir(), id + ".sock");
}

function connect(p, tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const sock = net.connect(p);
      sock.once("connect", () => resolve(sock));
      sock.once("error", () => (n > 0 ? setTimeout(() => attempt(n - 1), 100) : reject(new Error("could not connect to mpv IPC"))));
    };
    attempt(tries);
  });
}

export const CONTROLS =
  "SPACE pause/resume   n/p next/prev ayah   ←/→ ±5s   ↑/↓ ±1min   >/< next/prev surah   r reconnect   q stop";

/**
 * @param tracks  [{ url, surah: {number,name}, timings: () => Promise<timings|null> }]
 */
export async function playInteractive(tracks) {
  const ipc = ipcPath();
  const mpv = spawn("mpv", [
    // --idle=yes so a premature end-file can be retried; we quit on the "idle" event instead.
    "--no-video", "--no-terminal", "--really-quiet", "--idle=yes", "--keep-open=no", ...MPV_NET_ARGS,
    `--input-ipc-server=${ipc}`, ...tracks.map((t) => t.url),
  ], { stdio: ["ignore", "ignore", "ignore"] });

  const exited = new Promise((res) => { mpv.on("exit", res); mpv.on("error", res); });
  let sock;
  try { sock = await connect(ipc); } catch (e) { mpv.kill(); throw e; }

  const state = { time: 0, duration: 0, paused: false, buffering: false, pos: 0 };
  // Stall watchdog: when the time last moved, and a pending position to restore after a reload.
  let lastProgress = Date.now(), reloadAt = null, reconnects = 0;
  const MAX_RECONNECTS = 5; // per track; reset when the next track starts
  const timingsCache = new Map();
  let timings = null;

  const send = (cmd) => { try { sock.write(JSON.stringify({ command: cmd }) + "\n"); } catch {} };
  const setProp = (k, v) => send(["set_property", k, v]);
  const seek = (v, mode = "relative") => send(["seek", v, mode]);

  const loadTimings = async (pos) => {
    const t = tracks[pos];
    if (!t) return;
    if (!timingsCache.has(pos)) timingsCache.set(pos, t.timings ? t.timings().catch(() => null) : Promise.resolve(null));
    const res = await timingsCache.get(pos);
    if (state.pos === pos) timings = res;
  };

  sock.on("data", (buf) => {
    for (const line of buf.toString().split("\n")) {
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.event === "property-change") {
        if (msg.name === "time-pos" && msg.data != null) {
          if (msg.data !== state.time) lastProgress = Date.now();
          state.time = msg.data;
        }
        else if (msg.name === "duration" && msg.data != null) state.duration = msg.data;
        else if (msg.name === "pause") state.paused = !!msg.data;
        else if (msg.name === "paused-for-cache") state.buffering = !!msg.data;
        else if (msg.name === "playlist-pos" && msg.data != null && msg.data !== state.pos) {
          state.pos = msg.data; state.time = 0; state.duration = 0; timings = null; reconnects = 0; loadTimings(state.pos);
        }
      } else if (msg.event === "end-file") {
        // A dead connection shows up as a premature "eof"/"error" well before the real end:
        // go back to the same spot instead of silently skipping the rest of the surah.
        const premature = (msg.reason === "eof" || msg.reason === "error") &&
          state.duration > 0 && state.time < state.duration - 3;
        if (premature && reconnects < MAX_RECONNECTS) {
          // Back off a little more each time (0s, 5s, 10s, …) so a short outage can pass.
          reloadAt = state.time; // set now so the "idle" event does not quit meanwhile
          setTimeout(reconnect, reconnects * 5000);
        }
      } else if (msg.event === "idle") {
        if (reloadAt == null) send(["quit"]); // playlist really finished (not a reload in flight)
      } else if (msg.event === "file-loaded") {
        lastProgress = Date.now();
        if (reloadAt != null) { seek(reloadAt, "absolute"); reloadAt = null; }
      }
    }
  });
  [["time-pos", 1], ["duration", 2], ["pause", 3], ["playlist-pos", 4], ["paused-for-cache", 5]]
    .forEach(([p, i]) => send(["observe_property", i, p]));

  // Restart the current track and jump back to where it was (survives a dead connection).
  const reconnect = () => {
    reloadAt = state.time; reconnects++; lastProgress = Date.now();
    send(["playlist-play-index", state.pos]);
  };
  loadTimings(0);

  // ---- rendering --------------------------------------------------------------------
  const render = () => {
    const cols = process.stdout.columns || 80;
    const track = tracks[state.pos] || tracks[0];
    const title = `${String(track.surah.number).padStart(3, "0")} ${track.surah.name}`;
    const cur = ayahAt(timings, state.time);
    const total = timings ? Math.max(...timings.map((a) => a.ayah)) : 0;
    const ayah = timings ? (cur && cur.ayah > 0 ? `Ayah ${cur.ayah}/${total}` : `Ayah –/${total}`) : chalk.dim("no ayah data");
    const time = `${fmt(state.time)} / ${fmt(state.duration)}`;
    const stalled = !state.paused && (state.buffering || reloadAt != null);
    const icon = state.paused ? chalk.yellow("⏸") : stalled ? chalk.yellow("…") : chalk.green("▶");
    const left = `${icon} ${chalk.bold(title)}  `;
    const note = reloadAt != null ? chalk.yellow("   reconnecting…") : stalled ? chalk.yellow("   buffering…") : "";
    const right = `  ${time}   ${ayah}${note}${tracks.length > 1 ? chalk.dim(`   [${state.pos + 1}/${tracks.length}]`) : ""}`;
    const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const barW = Math.max(10, cols - plain(left).length - plain(right).length - 3);
    const frac = state.duration ? Math.min(1, state.time / state.duration) : 0;
    const filled = Math.round(frac * barW);
    const bar = chalk.cyan("█".repeat(filled)) + chalk.dim("░".repeat(barW - filled));
    const line = left + bar + right;
    process.stdout.write("\r" + line + " ".repeat(Math.max(0, cols - 1 - plain(line).length)));
  };
  const timer = setInterval(() => {
    // Watchdog: not paused by the user, mpv reports buffering, and no progress for STALL_SECS.
    if (!state.paused && state.buffering && reloadAt == null && Date.now() - lastProgress > STALL_SECS * 1000) reconnect();
    render();
  }, 250);

  // ---- keys ---------------------------------------------------------------------------
  const nextAyah = () => {
    if (!timings) return seek(5);
    const nxt = timings.find((a) => a.start > state.time + 0.3);
    if (nxt) seek(nxt.start, "absolute"); else send(["playlist-next", "weak"]);
  };
  const prevAyah = () => {
    if (!timings) return seek(-5);
    const cur = ayahAt(timings, state.time);
    if (!cur) return seek(0, "absolute");
    if (state.time - cur.start > 2) return seek(cur.start, "absolute");
    const i = timings.indexOf(cur);
    seek(i > 0 ? timings[i - 1].start : 0, "absolute");
  };
  const onKey = (_str, key) => {
    if (!key) return;
    const n = key.name;
    if (n === "q" || n === "escape" || (key.ctrl && n === "c")) return send(["quit"]);
    if (n === "space" || n === "k") return send(["cycle", "pause"]);
    if (n === "r") return reconnect();
    if (n === "right" || n === "l") return seek(5);
    if (n === "left" || n === "h") return seek(-5);
    if (n === "up") return seek(60);
    if (n === "down") return seek(-60);
    if (n === "n" || n === "]" || n === ".") return nextAyah();
    if (n === "p" || n === "[" || n === ",") return prevAyah();
    if (_str === ">" || (key.shift && n === "n")) return send(["playlist-next", "weak"]);
    if (_str === "<" || (key.shift && n === "p")) return send(["playlist-prev", "weak"]);
  };
  const tty = process.stdin.isTTY;
  if (tty) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKey);
  }

  await exited;
  clearInterval(timer);
  render();
  process.stdout.write("\n");
  if (tty) {
    process.stdin.off("keypress", onKey);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  try { sock.destroy(); } catch {}
}
