// Once-a-day check of the npm registry for a newer quran-audio release. Never blocks startup.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";

const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const cachePath = path.join(os.homedir(), ".quran-audio-update.json");
const DAY = 24 * 60 * 60 * 1000;

function newer(a, b) {
  // true if a > b (semver x.y.z)
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function latestVersion(name) {
  try {
    const c = JSON.parse(await readFile(cachePath, "utf8"));
    if (c.name === name && Date.now() - c.checked < DAY) return c.latest;
  } catch {}
  const res = await fetch(`https://registry.npmjs.org/${name}/latest`, {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { version } = await res.json();
  writeFile(cachePath, JSON.stringify({ name, latest: version, checked: Date.now() })).catch(() => {});
  return version;
}

/** Resolves to a printable notice string, or null when up to date / offline / disabled. */
export async function updateNotice({ version: current } = {}) {
  if (process.env.QURAN_NO_UPDATE_CHECK) return null;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    const name = pkg.name, version = current || pkg.version;
    const latest = await latestVersion(name);
    if (!newer(latest, version)) return null;
    return [
      chalk.yellow(`  Update available: ${version} → ${latest}`),
      chalk.dim("  run: ") + chalk.cyan(`npm install -g ${name}@latest`),
    ].join("\n");
  } catch {
    return null;
  }
}
