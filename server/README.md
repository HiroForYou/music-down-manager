# musicdown-server

English · [Español](README.es.md)

Express server for MusicDown. Converts YouTube links (or any site supported by `yt-dlp`) to MP3, streams audio for the app's Spotify tab, and stores the likes sent by the Spicetify extension and the app's playlist backup.

## Running locally

```bash
pnpm install
cp .env.example .env      # set ACCESS_KEY
pnpm start
```

| Script | Use |
|---|---|
| `pnpm start` | Server on `PORT` (default 3008) |
| `pnpm start:tunnel` | Server + Cloudflare quick tunnel; prints the public https URL (changes on every start) |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3008` | HTTP port |
| `ACCESS_KEY` | empty | Key required in the `x-api-key` header. Empty = no authentication. `API_KEY` is accepted as an alias. |
| `YTDLP_PATH` | `yt-dlp` | `yt-dlp` path |
| `FFMPEG_PATH` | `ffmpeg` | `ffmpeg` path |
| `YT_PLAYER_CLIENT` | `web_embedded` | YouTube player client for `yt-dlp`. Empty = `yt-dlp` default. |
| `SPOTIFY_LIKES_FILE` | `data/spotify-likes.json` | Likes file |
| `LIBRARY_BACKUP_FILE` | `data/library-backup.json` | Playlists and liked songs backup |
| `STREAM_CACHE_DIR` | `data/stream-cache` | Audio cache for streaming |
| `STREAM_CACHE_MAX_FILES` | `60` | Max cached files |
| `CLOUDFLARED_PATH` | `cloudflared` | `cloudflared` path for `start:tunnel` |

## Endpoints

All endpoints except `/api/health` require `x-api-key` when `ACCESS_KEY` is set.

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | `{ ok: true }`. Used by the app's connection test. |
| GET | `/api/metadata?url=` | Title, artist, thumbnail and duration via `yt-dlp -j` |
| GET | `/api/convert?url=&filename=` | 192 kbps MP3 stream (`yt-dlp` piped into `ffmpeg`) |
| GET | `/api/progress?jobId=` | Conversion progress |
| GET | `/api/stream?q=` | First YouTube result for the query, with `Range` support |
| GET | `/api/spotify-likes` | Stored likes |
| POST | `/api/spotify-likes` | Replaces the likes. Body `{ tracks: [...] }` |
| DELETE | `/api/spotify-likes/:id` | Marks a like as removed from the app |
| GET | `/api/spotify-likes/removed` | Removals pending in Spotify |
| POST | `/api/spotify-likes/removed/ack` | Confirms removals applied by the extension |
| GET / PUT | `/api/library-backup` | Reads or stores the app backup |

`/api/spotify-likes*` routes send open CORS headers for the Spicetify extension.

## Docker

```bash
docker build -t musicdown-server .
docker run -p 3008:3008 \
  -e ACCESS_KEY=long-random-string \
  -v musicdown-data:/app/data \
  musicdown-server
```

| Point | Detail |
|---|---|
| Image | `node:22-slim`, `ffmpeg`, dependencies installed with pnpm from `pnpm-lock.yaml`, runs as `node` |
| `yt-dlp` | Pinned by `ARG YTDLP_VERSION`. Update with `--build-arg YTDLP_VERSION=<release>` when YouTube downloads fail. |
| Data | Without the `/app/data` volume, likes, backup and cache are lost when the container is recreated. |

## Security

| Point | Detail |
|---|---|
| `ACCESS_KEY` | Required if the server is reachable from the internet. There is no per-client rate limit. |
| Scope | Personal use. Do not expose as a public service for third parties. |
