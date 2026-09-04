# quran-audio

Download or stream Quran MP3 recitations from your terminal.
Search for a surah, search for a reciter, press **Run** (or **Play**) — done.

```
$ quran

? Surah (type to search): kahf
❯  18  Al-Kahf          الكهف

? Reciter (type to search): afasy
❯ Mishary Alafasi  مشاري العفاسي  [3 sources]

  surah 18 Al-Kahf by Mishary Alafasi
  sources: mp3quran → quranicaudio → islamic
  folder:  C:\Users\you\Quran\Mishary Alafasi

? Ready?  ❯ Run download
  ✓ 018 Al-Kahf  ← mp3quran.net
```

- 250+ reciters, all 114 surahs, or the full Quran in one go
- Search in English or Arabic (`kahf`, `18`, `الكهف`, `afasy`, `العفاسي`)
- 3 audio sources with automatic fallback — if one is down, the next is used
- Resume-friendly: already-downloaded files are skipped
- **Play** option: stream right away without saving anything, in the terminal (mpv / mpg123 / ffplay) or in your browser / default player

---

## Installation

`quran-audio` needs **Node.js 18 or newer**. Install Node.js for your platform, then install the CLI with npm.

### Windows

1. Install Node.js from <https://nodejs.org> (LTS, click through the installer), or with winget:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
2. Open a new **PowerShell** or **Windows Terminal** window and run:
   ```powershell
   npm install -g quran-audio
   ```
3. Run it:
   ```powershell
   quran
   ```

> **Tip:** use **Windows Terminal** (free in the Microsoft Store) rather than the old `cmd.exe` window.
> The old console cannot render Arabic, so Arabic names are hidden there automatically. In Windows Terminal they show correctly.

Downloads go to `C:\Users\<you>\Quran\<Reciter>\`.

### macOS

1. Install Node.js with [Homebrew](https://brew.sh):
   ```bash
   brew install node
   ```
   (or download the installer from <https://nodejs.org>)
2. Install the CLI:
   ```bash
   npm install -g quran-audio
   ```
3. Run it:
   ```bash
   quran
   ```

Downloads go to `~/Quran/<Reciter>/`.

### Linux

1. Install Node.js 18+.

   **Debian / Ubuntu**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
   **Fedora**
   ```bash
   sudo dnf install nodejs npm
   ```
   **Arch**
   ```bash
   sudo pacman -S nodejs npm
   ```
2. Install the CLI:
   ```bash
   sudo npm install -g quran-audio
   ```
   If you prefer not to use `sudo`, use a Node version manager such as [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm), then run `npm install -g quran-audio` without `sudo`.
3. Run it:
   ```bash
   quran
   ```

Downloads go to `~/Quran/<Reciter>/`.

### Android (Termux)

1. Install **Termux** from [F-Droid](https://f-droid.org/packages/com.termux/) or [GitHub](https://github.com/termux/termux-app/releases).
   (The Play Store version is outdated — avoid it.)
2. In Termux, update packages and install Node.js:
   ```bash
   pkg update && pkg upgrade -y
   pkg install -y nodejs
   ```
3. Install the CLI:
   ```bash
   npm install -g quran-audio
   ```
4. Give Termux access to your phone storage so the MP3s land in a folder your music player can see:
   ```bash
   termux-setup-storage
   ```
   Tap **Allow** when Android asks.
5. Run it, saving into your phone's Music folder:
   ```bash
   quran -o ~/storage/music/Quran
   ```
   Without `-o`, files go to `~/Quran` inside Termux's private storage, which other apps cannot see.

> Termux cannot render Arabic (letters show isolated and reversed), so Arabic names are hidden there by default.
> You can still *search* in Arabic — long-press → paste `الكهف` into the prompt works. Use `quran --arabic` to force Arabic labels on.

### Run without installing

On any platform with Node.js:

```bash
npx quran-audio
```

### Updating

```bash
npm update -g quran-audio
```

---

## Usage

```
quran [-o <folder>] [--arabic | --no-arabic]

  -o, --out     download folder (default: ~/Quran)
  --arabic      force Arabic names on
  --no-arabic   force Arabic names off
```

**Flow**

1. **Surah** — type to filter. Number, English name, Arabic name and common spellings all work (`36`, `yasin`, `ya-sin`, `يس`). Pick **★ All 114 surahs** to download the whole Quran.
2. **Reciter** — type to filter (`sudais`, `dosari`, `منشاوي`). The `[N sources]` tag shows how many backup sources that reciter has.
3. **Run download** — a progress bar per file. Files are named `001 - Al-Fatihah.mp3` inside a folder named after the reciter.
4. **Play** — streams the surah directly from the source. Nothing is saved to disk.
   - If `mpv`, `mpg123` or `ffplay` is installed, it streams inside the terminal. On "All 114 surahs" they stream in order as a playlist.
   - **Player controls** (mpv): `SPACE` pause / resume · `←` `→` seek 5 s · `↑` `↓` seek 1 min · `>` `<` next / previous surah · `q` stop.
     With mpg123: `SPACE` pause / resume, `f` next, `d` previous, `q` stop. ffplay cannot pause in the terminal, so mpv is recommended.
   - Otherwise the stream URL opens in your browser / default player (on Android via `termux-open`).
   - The same 3-source fallback applies: the first source that answers is streamed.

   To get in-terminal playback:
   ```bash
   winget install mpv          # Windows
   brew install mpv            # macOS
   sudo apt install mpv        # Debian / Ubuntu
   pkg install mpv             # Termux
   ```

Re-running the same surah/reciter skips files that already exist, so an interrupted full-Quran download simply continues where it stopped.

---

## Audio sources

Every file is tried against these sources, in order, until one succeeds:

| # | Source | Reciters | Notes |
|---|--------|----------|-------|
| 1 | [mp3quran.net](https://mp3quran.net) | ~240 | primary, live reciter API |
| 2 | [quranicaudio.com](https://quranicaudio.com) | ~175 | backup, live reciter API |
| 3 | [cdn.islamic.network](https://alquran.cloud/cdn) | ~15 | backup, the most popular reciters |

A failure means an HTTP error, a timeout, an HTML page instead of audio, or a truncated file.
Reciter lists from sources 1 and 2 are fetched live and merged by name, so the same sheikh appears once with all of their sources attached. `data/reciters.json` is a bundled snapshot that keeps the CLI working if an API is unreachable.

All audio is served by the sources above; this tool only downloads it. Please respect their terms of use.

---

## Development

```bash
git clone https://github.com/MHDN55/quran-audio.git
cd quran-audio
npm install
npm start               # run the CLI
npm run update-data     # refresh data/reciters.json from the live APIs
```

## License

MIT © [MHDN55](https://github.com/MHDN55)
