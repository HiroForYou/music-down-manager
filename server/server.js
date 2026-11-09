const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3008;
// Clave de acceso: la app (APK) y la extensión de Spotify la envían en la cabecera x-api-key.
// ACCESS_KEY es el nombre actual; API_KEY se sigue aceptando por compatibilidad.
const ACCESS_KEY = process.env.ACCESS_KEY || process.env.API_KEY || '';
const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
// Cliente de YouTube que usa yt-dlp. El cliente por defecto (android_vr) recibe 403 al descargar;
// web_embedded funciona. Se puede cambiar con YT_PLAYER_CLIENT (vacío = el de yt-dlp por defecto).
const YT_PLAYER_CLIENT = process.env.YT_PLAYER_CLIENT === undefined ? 'web_embedded' : process.env.YT_PLAYER_CLIENT;
const ytArgs = YT_PLAYER_CLIENT ? ['--extractor-args', `youtube:player_client=${YT_PLAYER_CLIENT}`] : [];
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const SPOTIFY_LIKES_FILE =
  process.env.SPOTIFY_LIKES_FILE || path.join(__dirname, 'data', 'spotify-likes.json');

const app = express();

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

app.use((req, res, next) => {
  log(`${req.method} ${req.originalUrl}`, `from ${req.ip}`);
  next();
});

function checkAuth(req, res, next) {
  if (!ACCESS_KEY) return next();
  if (req.get('x-api-key') !== ACCESS_KEY) {
    log('Rejected request: missing/invalid x-api-key');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function sanitizeFilename(name) {
  return String(name || 'track')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .slice(0, 80) || 'track';
}

// jobId -> { percent, stage }. Lets the app poll /api/progress while a
// /api/convert download+transcode is running, since the response body itself
// is the binary mp3 stream and can't also carry progress messages.
const jobs = new Map();

function setJobProgress(jobId, percent, stage) {
  if (!jobId) return;
  jobs.set(jobId, { percent, stage });
}

function clearJobLater(jobId, delayMs = 60000) {
  if (!jobId) return;
  setTimeout(() => jobs.delete(jobId), delayMs);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ---------- Spotify likes ----------

function spotifyLikesCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.set('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

app.use('/api/spotify-likes', spotifyLikesCors);

app.post('/api/spotify-likes', checkAuth, express.json({ limit: '25mb' }), (req, res) => {
  const incoming = Array.isArray(req.body?.tracks) ? req.body.tracks : null;
  if (!incoming) return res.status(400).json({ error: 'Body must be { tracks: [...] }' });
  // Los likes que se eliminaron desde la app no deben volver con la siguiente sincronización.
  const removed = readRemovedLikes();
  const tracks = removed.size ? incoming.filter((t) => !removed.has(t?.id)) : incoming;
  const snapshot = { total: tracks.length, tracks, syncedAt: Date.now() };
  try {
    fs.mkdirSync(path.dirname(SPOTIFY_LIKES_FILE), { recursive: true });
    const tmp = `${SPOTIFY_LIKES_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot));
    fs.renameSync(tmp, SPOTIFY_LIKES_FILE);
  } catch (err) {
    log('Failed to save spotify likes:', err.message);
    return res.status(500).json({ error: 'Could not save likes' });
  }
  log(`Saved ${tracks.length} spotify likes`);
  res.json({ ok: true, total: tracks.length, syncedAt: snapshot.syncedAt });
});

const REMOVED_LIKES_FILE = path.join(path.dirname(SPOTIFY_LIKES_FILE), 'spotify-likes-removed.json');

function readRemovedLikes() {
  try {
    return new Set(JSON.parse(fs.readFileSync(REMOVED_LIKES_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

// Likes eliminados desde la app que la extensión de Spicetify aún tiene que quitar de Spotify.
app.get('/api/spotify-likes/removed', checkAuth, (req, res) => {
  res.json({ ids: [...readRemovedLikes()] });
});

// La extensión confirma qué ids ya quitó de Spotify: dejan de ser "pendientes" (y si el usuario vuelve a
// darles like en Spotify, ya no se ocultan).
app.post('/api/spotify-likes/removed/ack', checkAuth, express.json({ limit: '1mb' }), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
  if (!ids) return res.status(400).json({ error: 'Body must be { ids: [...] }' });
  try {
    const removed = readRemovedLikes();
    ids.forEach((id) => removed.delete(id));
    fs.writeFileSync(REMOVED_LIKES_FILE, JSON.stringify([...removed]));
  } catch (err) {
    log('Failed to ack removed likes:', err.message);
    return res.status(500).json({ error: 'Could not update removed likes' });
  }
  log(`Acknowledged ${ids.length} removed likes`);
  res.json({ ok: true, pending: readRemovedLikes().size });
});

// Elimina un like de la lista del servidor y deja una "lápida" para que no vuelva al sincronizar.
app.delete('/api/spotify-likes/:id', checkAuth, (req, res) => {
  const id = String(req.params.id || '');
  if (!id) return res.status(400).json({ error: 'Missing id' });
  try {
    const removed = readRemovedLikes();
    removed.add(id);
    fs.mkdirSync(path.dirname(REMOVED_LIKES_FILE), { recursive: true });
    fs.writeFileSync(REMOVED_LIKES_FILE, JSON.stringify([...removed]));
    if (fs.existsSync(SPOTIFY_LIKES_FILE)) {
      const snapshot = JSON.parse(fs.readFileSync(SPOTIFY_LIKES_FILE, 'utf8'));
      snapshot.tracks = (snapshot.tracks || []).filter((t) => t?.id !== id);
      snapshot.total = snapshot.tracks.length;
      const tmp = `${SPOTIFY_LIKES_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot));
      fs.renameSync(tmp, SPOTIFY_LIKES_FILE);
    }
  } catch (err) {
    log('Failed to remove spotify like:', err.message);
    return res.status(500).json({ error: 'Could not remove like' });
  }
  log('Removed spotify like', id);
  res.json({ ok: true });
});

app.get('/api/spotify-likes', checkAuth, (req, res) => {
  if (!fs.existsSync(SPOTIFY_LIKES_FILE)) {
    return res.status(404).json({ error: 'No likes received yet' });
  }
  res.type('application/json').send(fs.readFileSync(SPOTIFY_LIKES_FILE, 'utf8'));
});

// ---------- Respaldo de playlists y "Me gustan" ----------
const LIBRARY_BACKUP_FILE = process.env.LIBRARY_BACKUP_FILE || path.join(path.dirname(SPOTIFY_LIKES_FILE), 'library-backup.json');

app.put('/api/library-backup', checkAuth, express.json({ limit: '10mb' }), (req, res) => {
  if (!req.body || typeof req.body !== 'object' || !Array.isArray(req.body.playlists)) {
    return res.status(400).json({ error: 'Body must be { playlists: [...] }' });
  }
  try {
    fs.mkdirSync(path.dirname(LIBRARY_BACKUP_FILE), { recursive: true });
    const tmp = `${LIBRARY_BACKUP_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...req.body, savedAt: Date.now() }));
    fs.renameSync(tmp, LIBRARY_BACKUP_FILE);
  } catch (err) {
    log('Failed to save library backup:', err.message);
    return res.status(500).json({ error: 'Could not save backup' });
  }
  log(`Saved library backup (${req.body.playlists.length} playlists)`);
  res.json({ ok: true });
});

app.get('/api/library-backup', checkAuth, (req, res) => {
  if (!fs.existsSync(LIBRARY_BACKUP_FILE)) return res.status(404).json({ error: 'No backup yet' });
  res.type('application/json').send(fs.readFileSync(LIBRARY_BACKUP_FILE, 'utf8'));
});

app.get('/api/progress', checkAuth, (req, res) => {
  const jobId = req.query.jobId;
  const job = jobId ? jobs.get(jobId) : null;
  res.json(job || { percent: 0, stage: 'unknown' });
});

app.get('/api/metadata', checkAuth, (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  log('metadata: fetching', url);

  const proc = spawn(YTDLP_PATH, [...ytArgs, '-j', '--no-warnings', '--no-playlist', url]);
  let out = '';
  let err = '';
  proc.stdout.on('data', (chunk) => {
    out += chunk;
  });
  proc.stderr.on('data', (chunk) => {
    err += chunk;
  });
  proc.on('error', (e) => {
    log('metadata: yt-dlp failed to start:', e.message);
    res.status(502).json({ error: 'yt-dlp is not available on the server' });
  });
  proc.on('close', (code) => {
    if (res.headersSent) return;
    if (code !== 0) {
      log('metadata: yt-dlp exited with code', code, err.slice(-500));
      return res.status(502).json({ error: 'yt-dlp failed', details: err.slice(-2000) });
    }
    try {
      const info = JSON.parse(out);
      log('metadata: ok ->', info.title, '/', info.uploader || info.channel);
      res.json({
        title: info.title || null,
        artist: info.uploader || info.channel || null,
        thumbnail: info.thumbnail || null,
        duration: info.duration || null,
      });
    } catch (e) {
      log('metadata: could not parse yt-dlp output:', e.message);
      res.status(502).json({ error: 'Could not parse yt-dlp output' });
    }
  });
});

const YTDLP_PROGRESS_RE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

// Para descargas por búsqueda ("ytsearch1:artista título", p. ej. los likes de Spotify): el primer resultado de
// YouTube puede ser un mix de horas, un video larguísimo o una versión equivocada. Se piden varios candidatos
// y se elige el primero con duración razonable de canción (45 s a 15 min).
const SEARCH_MIN_SECONDS = 45;
const SEARCH_MAX_SECONDS = 15 * 60;

function resolveSearchUrl(searchUrl) {
  const query = searchUrl.replace(/^ytsearch1:/i, '');
  return new Promise((resolve) => {
    const proc = spawn(YTDLP_PATH, [...ytArgs, '--flat-playlist', '-j', '--no-warnings', `ytsearch8:${query}`]);
    let out = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), 40000);
    proc.stdout.on('data', (c) => (out += c));
    proc.on('error', () => {
      clearTimeout(timer);
      resolve(searchUrl);
    });
    proc.on('close', () => {
      clearTimeout(timer);
      const candidates = out
        .split('\n')
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((c) => c && c.id);
      const good = candidates.find(
        (c) => typeof c.duration === 'number' && c.duration >= SEARCH_MIN_SECONDS && c.duration <= SEARCH_MAX_SECONDS
      );
      const pick = good || candidates.find((c) => typeof c.duration !== 'number') || null;
      if (!pick) return resolve(searchUrl); // sin candidatos válidos: se deja que yt-dlp decida
      resolve(`https://www.youtube.com/watch?v=${pick.id}`);
    });
  });
}

app.get('/api/convert', checkAuth, async (req, res) => {
  let url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  if (/^ytsearch1:/i.test(String(url))) {
    let aborted = false;
    req.on('close', () => {
      if (!res.writableEnded) aborted = true;
    });
    const resolved = await resolveSearchUrl(String(url));
    if (aborted) return;
    if (resolved !== url) log('convert: búsqueda', url, '->', resolved);
    url = resolved;
  }
  const filenameHint = sanitizeFilename(req.query.filename);
  const jobId = req.query.jobId;
  log('convert: starting', url, '-> filename hint:', filenameHint, jobId ? `(job ${jobId})` : '');
  setJobProgress(jobId, 0, 'downloading');

  const ytdlp = spawn(YTDLP_PATH, [...ytArgs, '-f', 'bestaudio/best', '--no-playlist', '--newline', '-o', '-', url]);
  const ffmpeg = spawn(FFMPEG_PATH, ['-i', 'pipe:0', '-vn', '-f', 'mp3', '-b:a', '192k', 'pipe:1']);

  let ytdlpErr = '';
  let ffmpegErr = '';
  let bytesStreamed = 0;
  ytdlp.stderr.on('data', (chunk) => {
    ytdlpErr += chunk;
    const text = chunk.toString();
    const match = text.match(YTDLP_PROGRESS_RE);
    if (match) {
      setJobProgress(jobId, Math.min(99, parseFloat(match[1])), 'downloading');
    }
  });
  ffmpeg.stderr.on('data', (chunk) => {
    ffmpegErr += chunk;
  });

  ytdlp.stdout.pipe(ffmpeg.stdin);

  const fail = (message, details) => {
    log('convert: FAILED -', message, details ? details.slice(-500) : '');
    setJobProgress(jobId, 0, 'error');
    clearJobLater(jobId, 5000);
    if (!res.headersSent) {
      res.status(502).json({ error: message, details: details ? details.slice(-2000) : undefined });
    } else {
      res.destroy();
    }
  };

  ytdlp.on('error', (e) => fail('yt-dlp is not available on the server', e.message));
  ffmpeg.on('error', (e) => fail('ffmpeg is not available on the server', e.message));

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      log('convert: yt-dlp exited with code', code, ytdlpErr.slice(-500));
    } else {
      setJobProgress(jobId, 99, 'converting');
    }
  });
  ffmpeg.on('close', (code) => {
    if (code !== 0 && !res.writableEnded) {
      fail('ffmpeg failed to convert audio', ffmpegErr);
    } else if (code === 0) {
      log(`convert: done - streamed ${bytesStreamed} bytes for`, url);
      setJobProgress(jobId, 100, 'done');
      clearJobLater(jobId);
    }
  });

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameHint}.mp3"`);
  ffmpeg.stdout.on('data', (chunk) => {
    bytesStreamed += chunk.length;
  });
  ffmpeg.stdout.pipe(res);

  req.on('close', () => {
    if (!res.writableEnded) {
      log('convert: client disconnected early for', url);
    }
    ytdlp.kill('SIGKILL');
    ffmpeg.kill('SIGKILL');
  });
});

// ---------- Streaming de audio (likes de Spotify) ----------
// La app pide /api/stream?q=<artista título>. El servidor busca el primer resultado en YouTube, descarga
// el audio con yt-dlp a una caché en disco y lo sirve con soporte de Range (seek, duración exacta).
// Se descarga completo con yt-dlp (y no se reenvía la URL directa de YouTube) porque los servidores de
// YouTube devuelven 403 a partir del primer MB a quien no sea yt-dlp.

const crypto = require('crypto');
const STREAM_CACHE_DIR = process.env.STREAM_CACHE_DIR || path.join(__dirname, 'data', 'stream-cache');
const STREAM_CACHE_MAX_FILES = Number(process.env.STREAM_CACHE_MAX_FILES || 60);
const streamInflight = new Map(); // id -> Promise<string> (ruta del archivo)

const AUDIO_TYPES = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

function pruneStreamCache() {
  try {
    const files = fs
      .readdirSync(STREAM_CACHE_DIR)
      .map((name) => path.join(STREAM_CACHE_DIR, name))
      .map((full) => ({ full, mtime: fs.statSync(full).mtimeMs }))
      .sort((x, y) => y.mtime - x.mtime);
    for (const f of files.slice(STREAM_CACHE_MAX_FILES)) fs.rmSync(f.full, { force: true });
  } catch (e) {
    log('stream: no se pudo limpiar la caché:', e.message);
  }
}

function findCached(id) {
  try {
    const name = fs.readdirSync(STREAM_CACHE_DIR).find((n) => n.startsWith(`${id}.`) && !n.endsWith('.part') && !n.endsWith('.ytdl'));
    return name ? path.join(STREAM_CACHE_DIR, name) : null;
  } catch {
    return null;
  }
}

function runYtdlpDownload(id, q, extraArgs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, [
      ...extraArgs,
      '-f',
      'bestaudio',
      '--no-playlist',
      '--no-warnings',
      '--no-part',
      '-o',
      path.join(STREAM_CACHE_DIR, `${id}.%(ext)s`),
      `ytsearch1:${q}`,
    ]);
    let err = '';
    proc.stderr.on('data', (c) => (err += c));
    const timer = setTimeout(() => proc.kill('SIGKILL'), 120000);
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`yt-dlp is not available: ${e.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const file = findCached(id);
      if (code !== 0 || !file) return reject(new Error(`yt-dlp exited with code ${code}: ${err.slice(-300)}`));
      resolve(file);
    });
  });
}

function downloadForStream(q) {
  const id = crypto.createHash('sha1').update(q.toLowerCase()).digest('hex').slice(0, 20);
  const cached = findCached(id);
  if (cached) {
    fs.utimesSync(cached, new Date(), new Date());
    return Promise.resolve(cached);
  }
  if (streamInflight.has(id)) return streamInflight.get(id);

  fs.mkdirSync(STREAM_CACHE_DIR, { recursive: true });
  const promise = runYtdlpDownload(id, q, ytArgs)
    // Si el cliente configurado falla, se reintenta una vez con el cliente por defecto de yt-dlp.
    .catch((e) => (ytArgs.length ? runYtdlpDownload(id, q, []) : Promise.reject(e)))
    .then((file) => {
      pruneStreamCache();
      return file;
    })
    .finally(() => streamInflight.delete(id));

  streamInflight.set(id, promise);
  return promise;
}

app.get('/api/stream', checkAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q parameter' });

  let aborted = false;
  req.on('close', () => {
    if (!res.writableEnded) aborted = true;
  });

  try {
    const file = await downloadForStream(q);
    if (aborted) return;
    const type = AUDIO_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // sendFile implementa Range / 206 / Content-Length.
    res.sendFile(file, { headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes' } }, (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: 'could not send file' });
    });
  } catch (e) {
    log('stream: failed for', q, e.message);
    if (!res.headersSent) res.status(502).json({ error: 'stream failed', details: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`musicdown server listening on port ${PORT}`);
  if (!ACCESS_KEY) {
    console.warn('WARNING: ACCESS_KEY is not set — this server accepts unauthenticated requests.');
  }
});
