# quran-audio

Download Quran MP3 recitations from your terminal.

```
npm install -g quran-audio
quran
```

1. Pick a **surah** (type to search: `kahf`, `18`, `الكهف`, or `all` for the full Quran)
2. Pick a **reciter** (type to search: `afasy`, `dosari`, `sudais` …)
3. Choose **Run download**

Files are saved to `~/Quran/<Reciter>/001 - Al-Fatihah.mp3`. Use `quran -o <folder>` to change the folder.
Already-downloaded files are skipped, so re-running "all surahs" resumes where it stopped.

## Sources (tried in order, per file)

| # | Source | Reciters |
|---|--------|----------|
| 1 | [mp3quran.net](https://mp3quran.net) | ~240 |
| 2 | [quranicaudio.com](https://quranicaudio.com) | ~175 |
| 3 | [cdn.islamic.network](https://alquran.cloud/cdn) | ~15 |

If source 1 fails (HTTP error, timeout, bad file), the same surah is retried from source 2, then 3.
Reciter lists are fetched live from sources 1 and 2 and merged by name; `data/reciters.json` is a bundled
snapshot used when an API is unreachable. Refresh it with `npm run update-data`.

## Development

```
npm install
npm start
```
