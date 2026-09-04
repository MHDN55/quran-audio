// Regenerates data/reciters.json (offline fallback) from the live APIs.
import { writeFile } from "node:fs/promises";
import { mergeReciters, snapshotPath, _internal } from "../src/sources.js";

const [a, b] = await Promise.all([_internal.fetchMp3Quran(), _internal.fetchQuranicAudio()]);
const merged = mergeReciters([a, b, _internal.islamicList()]);
await writeFile(snapshotPath(), JSON.stringify(merged, null, 1));
console.log(`wrote ${merged.length} reciters to ${snapshotPath()}`);
console.log("with 2+ sources:", merged.filter((r) => r.sources.length >= 2).length);
console.log("with 3 sources:", merged.filter((r) => r.sources.length === 3).map((r) => r.name).join(", "));
