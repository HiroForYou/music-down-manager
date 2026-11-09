// @ts-nocheck
// NAME: Musicdown Likes
// DESCRIPTION: Envía tus "Canciones que te gustan" al servidor de musicdown para verlas en la app móvil.
// Además quita de Spotify los likes que elimines desde la app (puedes desactivarlo en los ajustes).
//
// Usa la sesión del propio cliente de escritorio (no la Web API pública), así que no necesita
// Client ID ni Premium.

(async function musicdownLikes() {
  while (!window.Spicetify?.Platform || !Spicetify.Topbar || !Spicetify.LocalStorage || !Spicetify.showNotification) {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const SERVER_KEY = 'musicdown:serverUrl';
  const API_KEY_KEY = 'musicdown:apiKey';
  const AUTO_KEY = 'musicdown:autoSync';
  const REMOVE_KEY = 'musicdown:applyRemovals';
  const PAGE_SIZE = 50;
  // Tope de seguridad por si una API no devuelve el total y nunca responde una página vacía.
  const MAX_TRACKS = 20000;

  // Si la API no informa el total (o informa 0), se sigue paginando hasta recibir una página vacía.
  const positiveOrNull = (n) => (typeof n === 'number' && n > 0 ? n : null);

  const getConfig = () => ({
    serverUrl: (Spicetify.LocalStorage.get(SERVER_KEY) || 'http://localhost:3008').replace(/\/+$/, ''),
    apiKey: Spicetify.LocalStorage.get(API_KEY_KEY) || '',
    autoSync: Spicetify.LocalStorage.get(AUTO_KEY) !== 'false',
    applyRemovals: Spicetify.LocalStorage.get(REMOVE_KEY) !== 'false',
  });

  const log = (...args) => console.log('[musicdown-likes]', ...args);

  // ---------- Normalización ----------

  function trackIdFromUri(uri) {
    const match = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri || '');
    return match ? match[1] : null;
  }

  // Las APIs internas devuelven "spotify:image:<id>"; la app necesita una URL https.
  function imageUrl(raw) {
    if (!raw) return null;
    const match = /^spotify:image:([A-Za-z0-9]+)$/.exec(raw);
    return match ? `https://i.scdn.co/image/${match[1]}` : raw;
  }

  function pickImage(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return null;
    const sorted = [...sources].sort((a, b) => (b.width || 0) - (a.width || 0));
    return imageUrl(sorted[0].url);
  }

  function makeTrack({ uri, id, name, artists, album, image, addedAt }) {
    const trackId = id || trackIdFromUri(uri);
    if (!trackId || !name) return null;
    return {
      id: trackId,
      name,
      artists: (artists || []).filter(Boolean).join(', '),
      album: album || '',
      image: image || null,
      url: `https://open.spotify.com/track/${trackId}`,
      addedAt: addedAt || '',
    };
  }

  // ---------- Estrategias de lectura (la API interna cambia entre versiones del cliente) ----------

  async function viaGraphQL() {
    const def = Spicetify.GraphQL?.Definitions?.fetchLibraryTracks;
    if (!def || !Spicetify.GraphQL?.Request) throw new Error('GraphQL fetchLibraryTracks no disponible');
    const tracks = [];
    const seenIds = new Set();
    let offset = 0;
    let total = null;
    while (offset < MAX_TRACKS && (total === null || offset < total)) {
      const res = await Spicetify.GraphQL.Request(def, { offset, limit: PAGE_SIZE });
      const page = res?.data?.me?.library?.tracks;
      if (!page) throw new Error('Respuesta GraphQL inesperada');
      total = positiveOrNull(page.totalCount);
      const items = page.items || [];
      const before = tracks.length;
      for (const item of items) {
        const data = item.track?.data;
        const t = makeTrack({
          uri: item.track?._uri,
          name: data?.name,
          artists: data?.artists?.items?.map((a) => a.profile?.name),
          album: data?.albumOfTrack?.name,
          image: pickImage(data?.albumOfTrack?.coverArt?.sources),
          addedAt: item.addedAt?.isoString,
        });
        if (t && !seenIds.has(t.id)) {
          seenIds.add(t.id);
          tracks.push(t);
        }
      }
      if (items.length === 0 || tracks.length === before) break;
      offset += items.length;
    }
    return tracks;
  }

  async function viaLibraryAPI() {
    const api = Spicetify.Platform?.LibraryAPI;
    if (!api?.getTracks) throw new Error('LibraryAPI.getTracks no disponible');
    const tracks = [];
    const seenIds = new Set();
    let offset = 0;
    let total = null;
    while (offset < MAX_TRACKS && (total === null || offset < total)) {
      const page = await api.getTracks({ offset, limit: PAGE_SIZE });
      const items = page?.items || [];
      total = positiveOrNull(page?.totalLength ?? page?.total ?? page?.totalCount);
      const before = tracks.length;
      for (const item of items) {
        const t = makeTrack({
          uri: item.uri,
          name: item.name,
          artists: (item.artists || []).map((a) => a.name),
          album: item.album?.name,
          image: pickImage(item.album?.images),
          addedAt: item.addedAt instanceof Date ? item.addedAt.toISOString() : item.addedAt,
        });
        if (t && !seenIds.has(t.id)) {
          seenIds.add(t.id);
          tracks.push(t);
        }
      }
      if (items.length === 0 || tracks.length === before) break;
      offset += items.length;
    }
    return tracks;
  }

  async function viaWebAPI() {
    if (!Spicetify.CosmosAsync?.get) throw new Error('CosmosAsync no disponible');
    const tracks = [];
    let url = `https://api.spotify.com/v1/me/tracks?limit=${PAGE_SIZE}`;
    while (url) {
      const page = await Spicetify.CosmosAsync.get(url);
      for (const item of page?.items || []) {
        const t = makeTrack({
          id: item.track?.id,
          name: item.track?.name,
          artists: item.track?.artists?.map((a) => a.name),
          album: item.track?.album?.name,
          image: pickImage(item.track?.album?.images),
          addedAt: item.added_at,
        });
        if (t) tracks.push(t);
      }
      url = page?.next || null;
    }
    return tracks;
  }

  async function readLikedTracks() {
    const errors = [];
    for (const [name, strategy] of [
      ['graphql', viaGraphQL],
      ['libraryapi', viaLibraryAPI],
      ['webapi', viaWebAPI],
    ]) {
      try {
        const seen = new Set();
        const tracks = (await strategy()).filter((t) => !seen.has(t.id) && seen.add(t.id));
        log(`leídas ${tracks.length} canciones vía ${name}`);
        // Más recientes primero, como en la app.
        return tracks.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
      } catch (e) {
        log(`estrategia ${name} falló:`, e);
        errors.push(`${name}: ${e?.message || e}`);
      }
    }
    throw new Error(`No se pudieron leer los likes (${errors.join(' | ')})`);
  }

  // ---------- Likes eliminados desde la app ----------
  // Al eliminar una canción desde el reproductor de la app, el servidor guarda su id como "pendiente".
  // Aquí se quitan de la biblioteca real de Spotify y se confirma al servidor para que deje de listarlos.

  const authHeaders = (apiKey) => (apiKey ? { 'x-api-key': apiKey } : {});

  async function unlikeInSpotify(ids) {
    const uris = ids.map((id) => `spotify:track:${id}`);
    const api = Spicetify.Platform?.LibraryAPI;
    if (api?.remove) {
      await api.remove({ uris });
      return;
    }
    if (!Spicetify.CosmosAsync?.del) throw new Error('No hay forma de quitar likes en este cliente');
    for (let i = 0; i < ids.length; i += 50) {
      await Spicetify.CosmosAsync.del(`https://api.spotify.com/v1/me/tracks?ids=${ids.slice(i, i + 50).join(',')}`);
    }
  }

  // Devuelve cuántos likes se quitaron de Spotify.
  async function applyRemovals() {
    const { serverUrl, apiKey, applyRemovals: enabled } = getConfig();
    if (!enabled) return 0;
    let ids;
    try {
      const res = await fetch(`${serverUrl}/api/spotify-likes/removed`, { headers: authHeaders(apiKey) });
      if (!res.ok) return 0;
      ids = (await res.json()).ids || [];
    } catch (e) {
      log('no se pudo consultar los likes eliminados:', e);
      return 0;
    }
    if (ids.length === 0) return 0;
    try {
      await unlikeInSpotify(ids);
    } catch (e) {
      log('no se pudieron quitar likes de Spotify:', e);
      Spicetify.showNotification(`musicdown: no se pudieron quitar ${ids.length} likes de Spotify`, true);
      return 0; // sin confirmar: se reintenta en la próxima vuelta
    }
    try {
      await fetch(`${serverUrl}/api/spotify-likes/removed/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
        body: JSON.stringify({ ids }),
      });
    } catch (e) {
      log('no se pudo confirmar al servidor:', e);
    }
    Spicetify.showNotification(`musicdown: ${ids.length} like(s) eliminados desde la app se quitaron de Spotify`);
    log(`quitados ${ids.length} likes de Spotify`);
    return ids.length;
  }

  // ---------- Envío ----------

  let syncing = false;
  let pending = false;

  async function sync({ silent = false } = {}) {
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    try {
      const { serverUrl, apiKey } = getConfig();
      // Primero se quitan de Spotify los likes eliminados en la app, para no volver a enviarlos.
      await applyRemovals();
      const tracks = await readLikedTracks();
      const res = await fetch(`${serverUrl}/api/spotify-likes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
        body: JSON.stringify({ tracks }),
      });
      if (res.status === 401) {
        openSettings();
        throw new Error('API key incorrecta o vacía. Escríbela en el panel y vuelve a enviar.');
      }
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
      if (!silent) Spicetify.showNotification(`musicdown: ${tracks.length} likes enviados`);
      log(`enviadas ${tracks.length} canciones a ${serverUrl}`);
    } catch (e) {
      log('error al sincronizar:', e);
      Spicetify.showNotification(`musicdown: ${e?.message || 'error al enviar'}`, true);
    } finally {
      syncing = false;
      if (pending) {
        pending = false;
        sync({ silent: true });
      }
    }
  }

  // ---------- Ajustes ----------

  function openSettings() {
    const { serverUrl, apiKey, autoSync, applyRemovals: removeEnabled } = getConfig();
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    container.innerHTML = `
      <label>URL del servidor<br><input id="md-server" style="width:100%;padding:6px" /></label>
      <label>API key<br><input id="md-key" type="password" style="width:100%;padding:6px" /></label>
      <label><input id="md-auto" type="checkbox" /> Enviar automáticamente al dar o quitar like</label>
      <label><input id="md-remove" type="checkbox" /> Quitar de Spotify los likes que elimine desde la app</label>
      <button id="md-save" style="padding:8px;border-radius:16px;border:0;background:#1db954;color:#000;font-weight:700;cursor:pointer">Guardar</button>
    `;
    container.querySelector('#md-server').value = serverUrl;
    container.querySelector('#md-key').value = apiKey;
    container.querySelector('#md-auto').checked = autoSync;
    container.querySelector('#md-remove').checked = removeEnabled;
    container.querySelector('#md-save').addEventListener('click', () => {
      Spicetify.LocalStorage.set(SERVER_KEY, container.querySelector('#md-server').value.trim());
      Spicetify.LocalStorage.set(API_KEY_KEY, container.querySelector('#md-key').value.trim());
      Spicetify.LocalStorage.set(AUTO_KEY, String(container.querySelector('#md-auto').checked));
      Spicetify.LocalStorage.set(REMOVE_KEY, String(container.querySelector('#md-remove').checked));
      Spicetify.PopupModal.hide();
      Spicetify.showNotification('musicdown: ajustes guardados');
    });
    Spicetify.PopupModal.display({ title: 'Musicdown Likes', content: container });
  }

  // ---------- UI ----------

  new Spicetify.Topbar.Button(
    'Enviar likes a musicdown',
    'download',
    () => sync(),
    false
  );

  if (Spicetify.Menu?.Item) {
    new Spicetify.Menu.Item('Musicdown: ajustes', false, openSettings).register();
  }

  // ---------- Envío automático al cambiar la biblioteca ----------

  let debounceTimer = null;
  const scheduleSync = () => {
    if (!getConfig().autoSync) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => sync({ silent: true }), 3000);
  };

  try {
    const events = Spicetify.Platform?.LibraryAPI?.getEvents?.();
    if (events?.addListener) {
      events.addListener('update', scheduleSync);
      log('escuchando cambios de la biblioteca');
    }
  } catch (e) {
    log('no se pudo escuchar cambios de la biblioteca:', e);
  }

  // Mientras Spotify está abierto, cada minuto se revisa si desde la app se eliminó algún like.
  setInterval(async () => {
    if (!getConfig().applyRemovals) return;
    if ((await applyRemovals()) > 0) sync({ silent: true });
  }, 60000);

  // Un envío al abrir Spotify, por si hubo likes desde el celular.
  setTimeout(() => {
    if (getConfig().autoSync) sync({ silent: true });
  }, 8000);
})();
