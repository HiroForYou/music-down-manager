# app-mp3-download

English · [Español](README.es.md)

MusicDown monorepo: an Android app to download, play and organize music, a self-hosted server that converts YouTube links to MP3, and a Spotify desktop extension that syncs liked songs.

## Components

| Folder | Description | Stack |
|---|---|---|
| `musicdown/` | Mobile app (Android first) | Expo SDK 54, React Native 0.81, Expo Router, NativeWind 5 |
| `server/` | Conversion, streaming, Spotify likes and library backup API | Node.js, Express, `yt-dlp`, `ffmpeg` |
| `spicetify/` | Extension that sends Spotify likes to the server and applies removals made in the app | Spicetify |
| `docs/` | Feature reference in Spanish ([FEATURES.md](docs/FEATURES.md)) and UI mockups ([design/](docs/design/)) | - |

```
Spotify desktop ──(spicetify)──► server ◄──── MusicDown app
                                   │
                            yt-dlp + ffmpeg
```

## App features

| Tab / screen | Features |
|---|---|
| Music | Local library ("My downloads" and the phone's Music folder), search, sorting, multi-select, playlists |
| Spotify | Liked songs with offline cache, search, streaming through the server, download to the library |
| Download | Direct link download (MP3 or YouTube) and built-in YouTube browser with basic ad blocking |
| Now playing | Global player with queue, synced lyrics (LRCLIB) and cover-tinted background |
| Edit song | Title, artist, album and cover (gallery or iTunes search); writes ID3 tags to the file |
| Settings | Server and access key, privacy, battery saver, offline mode, themes |
| Android widgets | 9 "Now playing" variants (4×1, 4×2, 4×4, 2×2; opaque, translucent, transparent) |

| Behavior | Detail |
|---|---|
| Privacy | On by default. Downloads are stored in private app storage with a `.zc3` extension and hidden from other apps. Sharing sends a `.mp3` copy. |
| Backup | Playlists and liked songs are copied to the server after each change. A fresh install restores the backup. |
| Background | A silent audio track with a media notification keeps the app alive during long downloads. |
| Offline mode | No server or internet use; only plays local audio. |

Full list: [docs/FEATURES.md](docs/FEATURES.md) (Spanish only, matching the app's UI language).

## Requirements

| Component | Requirement |
|---|---|
| `server/` | Node.js 22+, pnpm 11, `yt-dlp` and `ffmpeg` on `PATH`. Optional: `cloudflared` for public access. |
| `musicdown/` | Node.js 22, pnpm 11, Expo (EAS) account for builds |
| `spicetify/` | Spotify desktop with [Spicetify](https://spicetify.app) installed |

EAS builds run on Node 22.13 (`musicdown/eas.json`); the server Docker image uses `node:22-slim`.

## Getting started

### 1. Server

```bash
cd server
pnpm install
cp .env.example .env      # set ACCESS_KEY
pnpm start                # local network only, port 3008
pnpm start:tunnel         # local network + public https URL (Cloudflare quick tunnel)
```

The tunnel URL changes on every start. Endpoints, environment variables and Docker: [server/README.md](server/README.md).

### 2. Mobile app

The app uses native modules (widgets, patched WebView), so it does not run in Expo Go. It needs a development build:

```bash
cd musicdown
pnpm install
npx eas-cli build --profile development --platform android   # install the resulting APK
npx expo start --dev-client
```

Standalone APK (no dev server):

```bash
npx eas-cli build --profile preview --platform android
```

In the app, open Settings, enter the server URL and access key (same value as `ACCESS_KEY`), then tap "Probar conexión".

### 3. Spotify extension (optional)

```bash
# Copy spicetify/musicdown-likes.js into the Spicetify Extensions folder, then:
spicetify config extensions musicdown-likes.js
spicetify apply
```

Configure the server URL and key from the Spotify profile menu ("Musicdown: ajustes"). The top bar button forces a sync.

## Dependency patches

Declared in `musicdown/pnpm-workspace.yaml` and applied by pnpm on install.

| Package | File |
|---|---|
| `expo-audio@1.1.1` | `patches/expo-audio@1.1.1.patch` |
| `expo-media-library` | `patches/expo-media-library.patch` |
| `react-native-webview@13.15.0` | `patches/react-native-webview@13.15.0.patch` |

Upgrading any of these packages requires regenerating its patch.

## License

[MIT](LICENSE). The license covers this repository's code only. `yt-dlp`, `ffmpeg` and Spicetify are external tools with their own licenses.

## Legal notice

Personal, self-hosted use only. Downloading audio from YouTube may violate its Terms of Service depending on the content and your jurisdiction. Do not expose the server as a public service for third parties.
