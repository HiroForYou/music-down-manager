import { setAudioModeAsync, useAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { isAppActive } from './appActive';
import { subscribeKeepAlive } from './keepAlive';
import { getPowerPrefs } from './powerPrefs';
import { getServerSettings } from './settings';
import { subscribeTrackDeleted } from './trackEvents';
import { getServerStatus } from './serverStatus';
import { getSpotifyPrefs } from './spotifyPrefs';
import { getPlayerControllerRef, pushWidgetState } from './widgetBridge';
import { YOUTUBE_AD_BLOCK_SCRIPT } from './youtubeAdBlock';
import { YOUTUBE_BACKGROUND_PLAY_SCRIPT } from './youtubeBackgroundPlay';
import { YOUTUBE_PLAYER_SCRIPT } from './youtubePlayerScript';

// Reproductor único de la app.
// - Canciones descargadas ("local"): se reproducen desde el archivo con expo-audio.
// - Likes de Spotify ("spotify"): una WebView invisible abre la búsqueda de YouTube, el script toma el
//   primer resultado y lo reproduce. Solo se escucha el audio; el video nunca se muestra.

export type PlayerStatus = 'idle' | 'loading' | 'ad' | 'playing' | 'paused' | 'error';
export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerItem {
  id: string;
  title: string;
  artist: string;
  image: string | null;
  kind: 'local' | 'spotify';
  /** Solo para kind = 'local'. */
  fileUri?: string;
  /** Id del like de Spotify del que viene (o al que corresponde) esta canción. */
  spotifyId?: string;
}

interface PlayerState {
  queue: PlayerItem[];
  index: number;
  status: PlayerStatus;
  position: number;
  duration: number;
  error: string | null;
  /** audio = expo-audio (archivo o stream del servidor); web = WebView de YouTube (respaldo). */
  engine: 'audio' | 'web';
  /** Resolviendo la canción en el servidor, aún sin reproducir. */
  preparing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
}

interface BackgroundPlayerApi extends PlayerState {
  current: PlayerItem | null;
  playQueue: (queue: PlayerItem[], index: number) => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (delta: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  stop: () => void;
}

const INJECTED = YOUTUBE_BACKGROUND_PLAY_SCRIPT + YOUTUBE_AD_BLOCK_SCRIPT + YOUTUBE_PLAYER_SCRIPT;

const initialState: PlayerState = {
  queue: [],
  index: -1,
  status: 'idle',
  position: 0,
  duration: 0,
  error: null,
  engine: 'audio',
  preparing: false,
  shuffle: false,
  repeat: 'off',
};

const BackgroundPlayerContext = createContext<BackgroundPlayerApi | null>(null);

// Contexto liviano para las listas: solo cambia al cambiar de canción, no cada segundo con el progreso.
interface PlayerSelection {
  currentId: string | null;
  /** Estado grueso de la canción actual (no cambia con el progreso). */
  currentState: 'loading' | 'playing' | 'paused';
  playQueue: (queue: PlayerItem[], index: number) => void;
}
const PlayerSelectionContext = createContext<PlayerSelection | null>(null);

function searchUrl(track: PlayerItem): string {
  const query = `${track.artist} ${track.title}`;
  // El parámetro "md" fuerza una carga nueva aunque se repita la misma canción.
  return `https://m.youtube.com/results?search_query=${encodeURIComponent(query)}&md=${Date.now()}`;
}

/**
 * Estado del reproductor nativo SIN renderizar la interfaz cuando no se ve.
 * - Cada evento del reproductor se entrega a `onEvent` (lógica de fin de canción, botones externos, etc.), con la
 *   pantalla encendida o apagada.
 * - El estado de React solo se actualiza con la app en primer plano, y como mucho una vez por `minIntervalMs`
 *   (salvo cambios importantes: play/pausa, carga, fin). Así, mientras suena música toda la noche, la app no
 *   acumula trabajo de dibujo que nadie ve.
 */
function useAudioStatus(
  player: AudioPlayer,
  onEvent: (status: AudioStatus, previous: AudioStatus) => void,
  getMinIntervalMs: () => number
): AudioStatus {
  const [status, setStatus] = useState<AudioStatus>(player.currentStatus);
  const latest = useRef<AudioStatus>(status);
  const lastEmit = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const intervalRef = useRef(getMinIntervalMs);
  intervalRef.current = getMinIntervalMs;

  useEffect(() => {
    latest.current = player.currentStatus;
    setStatus(player.currentStatus);
    const sub = player.addListener('playbackStatusUpdate', (next: AudioStatus) => {
      const prev = latest.current;
      latest.current = next;
      onEventRef.current(next, prev);
      if (!isAppActive()) return;
      const important =
        next.playing !== prev.playing ||
        next.isLoaded !== prev.isLoaded ||
        next.didJustFinish ||
        (prev.duration === 0 && next.duration > 0);
      const now = Date.now();
      if (important || now - lastEmit.current >= intervalRef.current()) {
        lastEmit.current = now;
        setStatus(next);
      }
    });
    // Al volver a primer plano se pone al día la interfaz con lo último que se supo.
    const appSub = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') {
        lastEmit.current = Date.now();
        setStatus(latest.current);
      }
    });
    return () => {
      sub.remove();
      appSub.remove();
    };
  }, [player]);

  return status;
}

/** La notificación solo carga carátulas http(s) o archivos del teléfono; cualquier otra cosa la haría fallar. */
function lockArtwork(image: string | null | undefined): string | undefined {
  return image && /^(https?:|file:)/.test(image) ? image : undefined;
}

export function BackgroundPlayerProvider({ children }: { children: ReactNode }) {
  const webviewRef = useRef<WebView>(null);
  const [state, setState] = useState<PlayerState>(initialState);
  const [uri, setUri] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Los eventos nativos llegan una vez por segundo (500 ms por defecto): menos despertares del procesador.
  const audio = useAudioPlayer(null, { updateInterval: 1000 });
  const audioEventRef = useRef<(s: AudioStatus, prev: AudioStatus) => void>(() => {});
  const sessionEventRef = useRef<(s: AudioStatus, prev: AudioStatus) => void>(() => {});
  const uiInterval = () => (getPowerPrefs().saveEnergy ? 2000 : 1000);
  const audioStatus = useAudioStatus(audio, (s, prev) => audioEventRef.current(s, prev), uiInterval);

  // Reproductor "ancla" para los likes de Spotify: el audio real suena en la WebView (Android no muestra
  // controles de bloqueo para eso), así que un audio silencioso en bucle sostiene la sesión multimedia
  // (notificación / pantalla de bloqueo) y sus botones se traducen a la WebView.
  const session = useAudioPlayer(require('../assets/silence.wav'), { updateInterval: 1000 });
  useAudioStatus(session, (s, prev) => sessionEventRef.current(s, prev), uiInterval);
  useEffect(() => {
    session.loop = true;
  }, [session]);

  // Con la WebView hay que mezclar con otros audios para que la sesión silenciosa no le quite el foco.
  const setMixMode = useCallback((mix: boolean) => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: mix ? 'mixWithOthers' : 'doNotMix',
    }).catch(() => {});
  }, []);

  // Para que el audio siga sonando con la pantalla bloqueada o la app en segundo plano.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
  }, []);

  const loadToken = useRef(0);
  const lastProbe = useRef({ pos: 0, t: 0 });
  const ignoreJumpUntil = useRef(0);
  const askedNotifications = useRef(false);
  // Canción para la que ya se activaron los controles de bloqueo con el archivo cargado.
  const lockReadyFor = useRef<string | null>(null);

  const activateLockScreen = useCallback(
    (item: PlayerItem) => {
      // Controles en la pantalla de bloqueo / notificación multimedia (play, pausa y ±10 s).
      try {
        audio.setActiveForLockScreen(
          true,
          { title: item.title, artist: item.artist, artworkUrl: lockArtwork(item.image) },
          { showSeekBackward: true, showSeekForward: true }
        );
      } catch {
        // Sin soporte en este build: la reproducción sigue sin controles de bloqueo.
      }
    },
    [audio]
  );

  const load = useCallback(
    async (queue: PlayerItem[], index: number) => {
      const item = queue[index];
      if (!item) return;
      const token = ++loadToken.current;
      ignoreJumpUntil.current = Date.now() + 2500;
      lastProbe.current = { pos: 0, t: 0 };
      lockReadyFor.current = null;

      // Android 13+: sin este permiso la notificación multimedia puede no mostrarse.
      if (Platform.OS === 'android' && !askedNotifications.current) {
        askedNotifications.current = true;
        PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never).catch(() => {});
      }

      const local = item.kind === 'local' && !!item.fileUri;
      setState((s) => ({
        ...s,
        queue,
        index,
        status: 'loading',
        position: 0,
        duration: 0,
        error: null,
        preparing: !local,
        engine: local ? 'audio' : s.engine,
      }));

      if (local) {
        setUri(null);
        setMixMode(false);
        session.pause();
        try {
          session.clearLockScreenControls();
        } catch {}
        audio.replace(item.fileUri as string);
        audio.play();
        activateLockScreen(item);
        // Un archivo local abre en milisegundos. Si no carga, no existe o está dañado: se avisa en vez de
        // quedarse en "Buscando audio…" para siempre.
        setTimeout(() => {
          if (token === loadToken.current && stateRef.current.engine === 'audio' && !audio.isLoaded) {
            setState((s) => ({ ...s, status: 'error', error: 'No se pudo abrir el archivo (¿se eliminó?).' }));
          }
        }, 6000);
        return;
      }

      // Modo sin conexión: lo que no está descargado no se puede reproducir (haría falta internet).
      if (getPowerPrefs().offlineMode) {
        audio.pause();
        session.pause();
        setUri(null);
        setState((s) => ({ ...s, engine: 'audio', preparing: false, status: 'error', error: 'Sin conexión: descarga esta canción para escucharla.' }));
        return;
      }

      // Likes de Spotify.
      // 1) Con el servidor: descarga la canción (yt-dlp) y suena con el reproductor nativo, que responde al
      //    widget y a la pantalla de bloqueo aunque la app esté en segundo plano.
      // 2) Respaldo: WebView de YouTube. Sus controles externos solo se aplican al volver a la app, porque
      //    React Native no entrega órdenes a las vistas mientras la app está pausada.
      audio.pause();
      session.pause();
      try {
        session.clearLockScreenControls();
      } catch {}
      setUri(null);

      const useWebView = () => {
        try {
          audio.clearLockScreenControls();
        } catch {}
        audio.pause();
        setMixMode(true);
        try {
          session.setActiveForLockScreen(
            true,
            { title: item.title, artist: item.artist, artworkUrl: item.image ?? undefined },
            { showSeekBackward: true, showSeekForward: true }
          );
        } catch {
          // Sin soporte en este build: Spotify suena igual, sin controles de bloqueo.
        }
        session.play();
        lastProbe.current = { pos: 0, t: 0 };
        setState((s) => ({ ...s, engine: 'web', preparing: false }));
        setUri(searchUrl(item));
      };

      // Por defecto (Ajustes > Spotify) los likes suenan con el YouTube invisible. El streaming desde el servidor
      // solo se usa si está activado en Ajustes; y aun así, si no hay conexión con el servidor, se usa la WebView.
      if (!getSpotifyPrefs().streamFromServer) {
        useWebView();
        return;
      }

      try {
        const { serverUrl, apiKey } = await getServerSettings();
        const base = serverUrl.trim().replace(/\/+$/, '');
        if (!base) throw new Error('Sin servidor configurado');
        // El ping de arranque ya sabe si el servidor está disponible: no se espera para saltar al respaldo.
        const known = getServerStatus();
        if (known === 'offline' || known === 'unauthorized' || known === 'unconfigured') throw new Error('Servidor no disponible');
        const url = `${base}/api/stream?q=${encodeURIComponent(`${item.artist} ${item.title}`)}`;
        const headers: Record<string, string> = apiKey ? { 'x-api-key': apiKey } : {};
        // Si el servidor no responde en 2,5 s (apagado, otra red, sin internet) se usa el respaldo de inmediato,
        // sin esperar a que venza el tiempo de la descarga.
        const healthController = new AbortController();
        const healthTimer = setTimeout(() => healthController.abort(), 2500);
        try {
          const health = await fetch(`${base}/api/health`, { signal: healthController.signal });
          if (!health.ok) throw new Error(`HTTP ${health.status}`);
        } finally {
          clearTimeout(healthTimer);
        }
        // Pre-vuelo: el servidor descarga el audio (unos segundos) y lo deja en caché; la petición real
        // del reproductor responde de inmediato.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 70000);
        try {
          const probe = await fetch(url, { headers: { ...headers, Range: 'bytes=0-0' }, signal: controller.signal });
          if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
        } finally {
          clearTimeout(timer);
        }
        if (token !== loadToken.current) return;
        setMixMode(false);
        audio.replace({ uri: url, headers });
        audio.play();
        activateLockScreen(item);
        setState((s) => ({ ...s, engine: 'audio', preparing: false }));
        // Vigilante: si el reproductor nativo no llega a cargar el audio, se cambia a la WebView.
        setTimeout(() => {
          if (token === loadToken.current && stateRef.current.engine === 'audio' && !audio.isLoaded) useWebView();
        }, 20000);
      } catch {
        if (token === loadToken.current) useWebView();
      }
    },
    [audio, session, setMixMode, activateLockScreen]
  );

  const playQueue = useCallback((queue: PlayerItem[], index: number) => load(queue, index), [load]);

  const stop = useCallback(() => {
    loadToken.current++;
    audio.pause();
    session.pause();
    try {
      session.clearLockScreenControls();
    } catch {}
    try {
      audio.clearLockScreenControls();
    } catch {}
    setUri(null);
    setState((s) => ({ ...initialState, shuffle: s.shuffle, repeat: s.repeat }));
  }, [audio, session]);

  const pickNext = useCallback((auto: boolean): number => {
    const { queue, index, shuffle, repeat } = stateRef.current;
    if (auto && repeat === 'one') return index;
    if (shuffle && queue.length > 1) {
      let candidate = index;
      while (candidate === index) candidate = Math.floor(Math.random() * queue.length);
      return candidate;
    }
    if (index + 1 < queue.length) return index + 1;
    return repeat === 'all' ? 0 : -1;
  }, []);

  const advance = useCallback(
    (auto: boolean) => {
      const target = pickNext(auto);
      if (target < 0) stop();
      else load(stateRef.current.queue, target);
    },
    [pickNext, load, stop]
  );

  const next = useCallback(() => advance(false), [advance]);

  const seekTo = useCallback(
    (seconds: number) => {
      const item = stateRef.current.queue[stateRef.current.index];
      if (!item) return;
      ignoreJumpUntil.current = Date.now() + 1500; // saltos propios: no son botones externos
      if (stateRef.current.engine === 'audio') {
        audio.seekTo(seconds);
      } else {
        webviewRef.current?.injectJavaScript(`window.__mdSeek && window.__mdSeek(${Number(seconds) || 0}); true;`);
        setState((s) => ({ ...s, position: seconds }));
      }
    },
    [audio]
  );

  const previous = useCallback(() => {
    const { queue, index, engine } = stateRef.current;
    const position = engine === 'audio' ? audio.currentTime : stateRef.current.position;
    // Como en cualquier reproductor: si ya avanzó, vuelve al inicio de la canción.
    if (position > 5 || index <= 0) {
      seekTo(0);
      return;
    }
    load(queue, index - 1);
  }, [audio, load, seekTo]);

  const seekBy = useCallback(
    (delta: number) => {
      const item = stateRef.current.queue[stateRef.current.index];
      if (!item) return;
      const audioEngine = stateRef.current.engine === 'audio';
      const position = audioEngine ? audio.currentTime : stateRef.current.position;
      const duration = audioEngine ? audio.duration : stateRef.current.duration;
      seekTo(Math.max(0, Math.min(duration || Infinity, position + delta)));
    },
    [audio, seekTo]
  );

  const togglePlay = useCallback(() => {
    const { queue, index, status } = stateRef.current;
    const item = queue[index];
    if (!item) return;
    if (stateRef.current.engine === 'audio' && !stateRef.current.preparing) {
      if (status === 'error') {
        load(queue, index);
        return;
      }
      if (audio.playing) audio.pause();
      else audio.play();
      return;
    }
    if (status === 'error' || status === 'idle') {
      load(queue, index);
      return;
    }
    const desired = status === 'paused' ? 'play' : 'pause';
    webviewRef.current?.injectJavaScript(`window.__mdSetDesired && window.__mdSetDesired('${desired}'); true;`);
    setState((s) => ({ ...s, status: desired === 'play' ? 'playing' : 'paused' }));
  }, [audio, load]);

  const toggleShuffle = useCallback(() => setState((s) => ({ ...s, shuffle: !s.shuffle })), []);
  const cycleRepeat = useCallback(
    () => setState((s) => ({ ...s, repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),
    []
  );

  // Estado de la WebView -> sesión silenciosa (para que la notificación muestre play/pausa correctos).
  useEffect(() => {
    if (state.engine !== 'web' || !state.queue[state.index]) return;
    const wantsPlaying = state.status === 'playing' || state.status === 'loading' || state.status === 'ad';
    if (wantsPlaying && !session.playing) session.play();
    else if ((state.status === 'paused' || state.status === 'error') && session.playing) session.pause();
  }, [state.engine, state.status, state.index, state.queue, session]);

  // Pantalla de bloqueo / notificación: los botones "anterior" y "siguiente" son, para Android, los saltos
  // de ±10 s del reproductor (expo-audio no ofrece botones de pista; el parche de iconos los dibuja como
  // anterior/siguiente). Un salto de ~10 s que no provocó la propia app se traduce a cambio de canción.
  const detectTrackButton = useCallback(
    (pos: number, playing: boolean) => {
      const now = Date.now();
      const prev = lastProbe.current;
      lastProbe.current = { pos, t: now };
      if (!prev.t || now < ignoreJumpUntil.current) return;
      const elapsed = playing ? (now - prev.t) / 1000 : 0;
      const jump = pos - prev.pos - elapsed;
      if (Math.abs(jump) >= 6 && Math.abs(jump) < 20) {
        ignoreJumpUntil.current = now + 1500;
        if (jump > 0) next();
        else previous();
      }
    },
    [next, previous]
  );

  // Descarga en lote: mientras dura, un audio silencioso con notificación multimedia ("Descargando…") evita
  // que Android suspenda la app al apagar la pantalla. Si ya hay música sonando, eso basta y no se hace nada.
  useEffect(() => {
    return subscribeKeepAlive((info) => {
      const st = stateRef.current;
      const musicInUse = st.queue[st.index] !== undefined;
      if (info.active) {
        if (musicInUse) return;
        setMixMode(true);
        try {
          session.setActiveForLockScreen(true, { title: info.title, artist: info.detail }, {});
        } catch {
          // Sin soporte de notificación multimedia: la descarga sigue, pero Android podría suspender la app.
        }
        if (!session.playing) session.play();
      } else if (!musicInUse) {
        session.pause();
        try {
          session.clearLockScreenControls();
        } catch {}
      }
    });
  }, [session, setMixMode]);

  // Notificación / pantalla de bloqueo -> WebView: play y pausa (respaldo con WebView).
  const mirrorSessionPlaying = (playing: boolean) => {
    const s = stateRef.current;
    if (s.engine !== 'web' || !s.queue[s.index]) return;
    const setDesired = (desired: 'play' | 'pause') => {
      webviewRef.current?.injectJavaScript(`window.__mdSetDesired && window.__mdSetDesired('${desired}'); true;`);
      setState((st) => ({ ...st, status: desired === 'play' ? 'playing' : 'paused' }));
    };
    if (playing && s.status === 'paused') setDesired('play');
    else if (!playing && (s.status === 'playing' || s.status === 'ad')) setDesired('pause');
  };

  // Eventos del reproductor nativo (se atienden sin pasar por React, con la pantalla encendida o apagada):
  // fin de canción y botones anterior/siguiente de la pantalla de bloqueo.
  const lastFinishAt = useRef(0);
  audioEventRef.current = (s) => {
    const st = stateRef.current;
    if (st.engine !== 'audio' || st.preparing || !st.queue[st.index]) return;
    if (s.didJustFinish) {
      const now = Date.now();
      if (now - lastFinishAt.current > 1500) {
        lastFinishAt.current = now;
        advance(true);
      }
      return;
    }
    // Los archivos de la carpeta Música a veces tardan en abrir: los controles de bloqueo se (re)activan cuando
    // el archivo ya está cargado, no solo al pulsar la canción, para que la notificación siempre aparezca.
    const item = st.queue[st.index];
    if (s.isLoaded && item && lockReadyFor.current !== item.id) {
      lockReadyFor.current = item.id;
      activateLockScreen(item);
    }
    detectTrackButton(s.currentTime || 0, s.playing);
  };
  // Respaldo con WebView: el audio silencioso hace de ancla de la sesión.
  sessionEventRef.current = (s, prev) => {
    if (stateRef.current.engine !== 'web') return;
    detectTrackButton(s.currentTime || 0, s.playing);
    if (s.playing !== prev.playing) mirrorSessionPlaying(s.playing);
  };

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: { type: string; [key: string]: unknown };
      try {
        message = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (message.type === 'ended') {
        advance(true);
      } else if (message.type === 'error') {
        setState((s) => ({ ...s, status: 'error', error: String(message.message ?? 'Error de reproducción') }));
      } else if (message.type === 'state') {
        setState((s) => {
          if (s.status === 'idle' || s.status === 'error') return s;
          const status: PlayerStatus = message.ad ? 'ad' : message.playing ? 'playing' : s.status === 'loading' ? 'loading' : 'paused';
          // Con la app en segundo plano solo importan los cambios de estado, no el avance de cada segundo.
          if (!isAppActive() && status === s.status) return s;
          return { ...s, status, position: Number(message.currentTime) || 0, duration: Number(message.duration) || 0 };
        });
      }
    },
    [advance]
  );

  const current = state.queue[state.index] ?? null;
  const isLocal = state.engine === 'audio' && !state.preparing && current !== null;

  const effectiveStatus: PlayerStatus = state.preparing
    ? 'loading'
    : state.status === 'error' && state.engine === 'audio'
      ? 'error'
      : isLocal
      ? audioStatus.playing
        ? 'playing'
        : audioStatus.isLoaded
          ? 'paused'
          : 'loading'
      : state.status;

  const api = useMemo<BackgroundPlayerApi>(() => {
    let merged: PlayerState = state;
    if (isLocal) {
      merged = { ...state, status: effectiveStatus, position: audioStatus.currentTime || 0, duration: audioStatus.duration || 0 };
    }
    return {
      ...merged,
      current,
      playQueue,
      togglePlay,
      next,
      previous,
      seekTo,
      seekBy,
      toggleShuffle,
      cycleRepeat,
      stop,
    };
  }, [
    state,
    isLocal,
    effectiveStatus,
    audioStatus.currentTime,
    audioStatus.duration,
    current,
    playQueue,
    togglePlay,
    next,
    previous,
    seekTo,
    seekBy,
    toggleShuffle,
    cycleRepeat,
    stop,
  ]);

  const currentId = current?.id ?? null;
  const currentState: PlayerSelection['currentState'] =
    effectiveStatus === 'loading' ? 'loading' : effectiveStatus === 'playing' || effectiveStatus === 'ad' ? 'playing' : 'paused';
  const selection = useMemo<PlayerSelection>(
    () => ({ currentId, currentState, playQueue }),
    [currentId, currentState, playQueue]
  );

  // Si se elimina una canción de la biblioteca, sale de la cola; si era la que sonaba, pasa a la siguiente
  // (o se detiene si no queda ninguna). Evita quedarse "buscando audio" de un archivo que ya no existe.
  useEffect(() => {
    return subscribeTrackDeleted((itemId) => {
      const { queue, index } = stateRef.current;
      const at = queue.findIndex((item) => item.id === itemId);
      if (at < 0) return;
      const remaining = queue.filter((item) => item.id !== itemId);
      if (remaining.length === 0) {
        stop();
      } else if (at === index) {
        load(remaining, Math.min(at, remaining.length - 1));
      } else {
        setState((s) => ({ ...s, queue: remaining, index: at < s.index ? s.index - 1 : s.index }));
      }
    });
  }, [load, stop]);

  // Widget de la pantalla de inicio: refleja la canción actual y recibe play/pausa/siguiente/anterior.
  const controllerRef = getPlayerControllerRef();
  controllerRef.current = { togglePlay, next, previous };
  const widgetPlaying = effectiveStatus === 'playing' || effectiveStatus === 'ad';
  useEffect(() => {
    pushWidgetState({
      hasTrack: current !== null,
      title: current?.title ?? '',
      artist: current?.artist ?? '',
      playing: widgetPlaying,
      image: current?.image ?? null,
    });
  }, [current?.id, current?.title, current?.artist, current?.image, widgetPlaying]);

  return (
    <PlayerSelectionContext.Provider value={selection}>
      <BackgroundPlayerContext.Provider value={api}>
        {children}
        {uri ? (
          <View pointerEvents="none" style={styles.hidden}>
            <WebView
              ref={webviewRef}
              source={{ uri }}
              injectedJavaScriptBeforeContentLoaded={INJECTED}
              injectedJavaScript={INJECTED}
              onMessage={handleMessage}
              mediaPlaybackRequiresUserAction={false}
              allowsInlineMediaPlayback
              onError={() => setState((s) => ({ ...s, status: 'error', error: 'No se pudo abrir YouTube.' }))}
            />
          </View>
        ) : null}
      </BackgroundPlayerContext.Provider>
    </PlayerSelectionContext.Provider>
  );
}

export function useBackgroundPlayer(): BackgroundPlayerApi {
  const ctx = useContext(BackgroundPlayerContext);
  if (!ctx) throw new Error('useBackgroundPlayer debe usarse dentro de BackgroundPlayerProvider');
  return ctx;
}

export function usePlayerSelection(): PlayerSelection {
  const ctx = useContext(PlayerSelectionContext);
  if (!ctx) throw new Error('usePlayerSelection debe usarse dentro de BackgroundPlayerProvider');
  return ctx;
}

const styles = StyleSheet.create({
  // Invisible pero montada y con tamaño de móvil: si fuera 0x0 o display:none, Chromium podría no
  // reproducir, y con un viewport diminuto YouTube puede no cargar el reproductor.
  hidden: { position: 'absolute', width: 360, height: 640, opacity: 0, left: 0, top: 0 },
});
