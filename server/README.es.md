# musicdown-server

[English](README.md) · Español

Servidor Express de MusicDown. Convierte enlaces de YouTube (o cualquier sitio soportado por `yt-dlp`) a MP3, sirve audio en streaming para la pestaña Spotify de la app, y guarda los likes enviados por la extensión de Spicetify y el respaldo de listas de la app.

## Ejecución local

```bash
pnpm install
cp .env.example .env      # definir ACCESS_KEY
pnpm start
```

| Script | Uso |
|---|---|
| `pnpm start` | Servidor en `PORT` (por defecto 3008) |
| `pnpm start:tunnel` | Servidor + túnel rápido de Cloudflare; imprime la URL https pública (cambia en cada arranque) |

## Variables de entorno

| Variable | Defecto | Descripción |
|---|---|---|
| `PORT` | `3008` | Puerto HTTP |
| `ACCESS_KEY` | vacío | Clave exigida en la cabecera `x-api-key`. Vacía = sin autenticación. `API_KEY` se acepta como alias. |
| `YTDLP_PATH` | `yt-dlp` | Ruta de `yt-dlp` |
| `FFMPEG_PATH` | `ffmpeg` | Ruta de `ffmpeg` |
| `YT_PLAYER_CLIENT` | `web_embedded` | Cliente de YouTube para `yt-dlp`. Vacío = el de `yt-dlp` por defecto. |
| `SPOTIFY_LIKES_FILE` | `data/spotify-likes.json` | Archivo de likes |
| `LIBRARY_BACKUP_FILE` | `data/library-backup.json` | Respaldo de listas y "Me gustan" |
| `STREAM_CACHE_DIR` | `data/stream-cache` | Caché de audio para streaming |
| `STREAM_CACHE_MAX_FILES` | `60` | Máximo de archivos en caché |
| `CLOUDFLARED_PATH` | `cloudflared` | Ruta de `cloudflared` para `start:tunnel` |

## Endpoints

Todos requieren `x-api-key` cuando `ACCESS_KEY` está definida, salvo `/api/health`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | `{ ok: true }`. Usado por "Probar conexión". |
| GET | `/api/metadata?url=` | Título, artista, miniatura y duración vía `yt-dlp -j` |
| GET | `/api/convert?url=&filename=` | MP3 192 kbps en streaming (`yt-dlp` a `ffmpeg`) |
| GET | `/api/progress?jobId=` | Avance de una conversión |
| GET | `/api/stream?q=` | Primer resultado de YouTube para la búsqueda, con soporte de `Range` |
| GET | `/api/spotify-likes` | Likes guardados |
| POST | `/api/spotify-likes` | Reemplaza los likes. Cuerpo `{ tracks: [...] }` |
| DELETE | `/api/spotify-likes/:id` | Marca un like como eliminado desde la app |
| GET | `/api/spotify-likes/removed` | Bajas pendientes de aplicar en Spotify |
| POST | `/api/spotify-likes/removed/ack` | Confirma bajas aplicadas por la extensión |
| GET / PUT | `/api/library-backup` | Lee o guarda el respaldo de la app |

Las rutas `/api/spotify-likes*` responden con CORS abierto para la extensión de Spicetify.

## Docker

```bash
docker build -t musicdown-server .
docker run -p 3008:3008 \
  -e ACCESS_KEY=clave-larga-aleatoria \
  -v musicdown-data:/app/data \
  musicdown-server
```

| Punto | Detalle |
|---|---|
| Imagen | `node:22-slim`, `ffmpeg`, dependencias instaladas con pnpm desde `pnpm-lock.yaml`, ejecución como usuario `node` |
| `yt-dlp` | Versión fija en `ARG YTDLP_VERSION`. Actualizar con `--build-arg YTDLP_VERSION=<release>` cuando fallen las descargas de YouTube. |
| Datos | Sin el volumen `/app/data`, los likes, el respaldo y la caché se pierden al recrear el contenedor. |

## Seguridad

| Punto | Detalle |
|---|---|
| `ACCESS_KEY` | Obligatoria si el servidor es accesible desde internet. No hay límite de uso por cliente. |
| Alcance | Uso personal. No exponer como servicio público para terceros. |
