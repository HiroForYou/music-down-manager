// Se importa cada peso por separado para no empaquetar las 18 variantes de Fraunces.
import { Fraunces_400Regular_Italic } from '@expo-google-fonts/fraunces/400Regular_Italic';
import { Fraunces_500Medium } from '@expo-google-fonts/fraunces/500Medium';
import { Fraunces_500Medium_Italic } from '@expo-google-fonts/fraunces/500Medium_Italic';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { Fraunces_600SemiBold_Italic } from '@expo-google-fonts/fraunces/600SemiBold_Italic';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { requireOptionalNativeModule } from 'expo';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';

import { AddToPlaylistSheet } from '../components/AddToPlaylistSheet';
import { ConfirmHost } from '../components/ConfirmHost';
import { ToastHost } from '../components/ToastHost';
import { Welcome } from '../components/Welcome';
import { BackgroundPlayerProvider } from '../lib/backgroundPlayer';
import { loadDisplaySettings, useHideSystemBars } from '../lib/display';
import { loadPrivacySettings } from '../lib/privacy';
import { cleanShareCache } from '../lib/share';
import { onServerOnline, startAutoBackup } from '../lib/backup';
import { loadPlaylists } from '../lib/playlists';
import { loadPowerPrefs, usePowerPrefs } from '../lib/powerPrefs';
import { loadThemePrefs } from '../lib/themePrefs';
import { loadSpotifyPrefs } from '../lib/spotifyPrefs';
import { checkServer, useServerStatus } from '../lib/serverStatus';
import { flushPendingLikeRemovals } from '../lib/spotify';
import { loadWelcomePrefs, useWelcomePrefs } from '../lib/welcomePrefs';
import { colors } from '../lib/theme';

import '../global.css';

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Fraunces_400Regular_Italic,
    Fraunces_500Medium,
    Fraunces_500Medium_Italic,
    Fraunces_600SemiBold,
    Fraunces_600SemiBold_Italic,
    Fraunces_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const pathname = usePathname();
  const hideBars = useHideSystemBars();
  const welcomePrefs = useWelcomePrefs();
  // Qué mostrar de la bienvenida: se decide una vez al arrancar y de nuevo si se pide "Ver introducción".
  const [welcome, setWelcome] = useState<{ id: number; splash: boolean; intro: boolean } | null>(null);
  const welcomeDecided = useRef(false);
  const showWelcome = welcome !== null;
  const closeWelcome = useCallback(() => setWelcome(null), []);

  useEffect(() => {
    loadDisplaySettings();
    loadPrivacySettings();
    loadWelcomePrefs();
    cleanShareCache();
    loadSpotifyPrefs();
    loadPowerPrefs();
    loadThemePrefs();
    loadPlaylists().then(startAutoBackup);
  }, []);

  // Con el servidor disponible: restaurar listas si la app es nueva, copiar cambios y enviar las
  // eliminaciones de likes que quedaron pendientes.
  const serverStatus = useServerStatus();
  const offlineMode = usePowerPrefs().offlineMode;
  // Al activar o desactivar el modo sin conexión se actualiza el estado del servidor (sin ping si está activo).
  useEffect(() => {
    checkServer();
  }, [offlineMode]);
  useEffect(() => {
    if (serverStatus !== 'online') return;
    onServerOnline();
    flushPendingLikeRemovals();
  }, [serverStatus]);

  useEffect(() => {
    if (!welcomePrefs.loaded || welcomeDecided.current) return;
    welcomeDecided.current = true;
    const intro = welcomePrefs.showIntro && !welcomePrefs.introSeen;
    if (welcomePrefs.showSplash || intro) setWelcome({ id: 0, splash: welcomePrefs.showSplash, intro });
  }, [welcomePrefs]);

  // "Ver introducción" (Ajustes): abre el carrusel ahora, sin la animación inicial.
  useEffect(() => {
    if (welcomePrefs.introRequest > 0) setWelcome({ id: welcomePrefs.introRequest, splash: false, intro: true });
  }, [welcomePrefs.introRequest]);

  // Ping al servidor al abrir la app y cada vez que vuelve a primer plano: según la respuesta se
  // habilitan o deshabilitan las opciones que lo necesitan (descargas, sincronizar likes).
  useEffect(() => {
    checkServer();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') checkServer();
    });
    return () => sub.remove();
  }, []);

  // Barra de navegación (la de notificaciones se oculta con <StatusBar hidden />).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // Carga diferida: si el dev client aún no se recompiló con este módulo nativo, la app
    // sigue funcionando (solo la barra de navegación no se oculta).
    // Se comprueba primero con requireOptionalNativeModule: un require() que falla igual
    // dispara el overlay de error de Metro en desarrollo, aunque se capture.
    if (!requireOptionalNativeModule('ExpoNavigationBar')) return;
    try {
      const NavigationBar = require('expo-navigation-bar') as typeof import('expo-navigation-bar');
      NavigationBar.setVisibilityAsync(hideBars ? 'hidden' : 'visible').catch(() => {});
    } catch {
      // Módulo nativo no disponible en este build.
    }
  }, [hideBars]);

  // Si las fuentes fallan, se sigue con las del sistema en vez de dejar la app en blanco.
  // Mismo color que la splash nativa para que el arranque sea continuo.
  if ((!loaded && !error) || !welcomePrefs.loaded) return <View style={{ flex: 1, backgroundColor: '#14212B' }} />;

  return (
    <BackgroundPlayerProvider>
      <StatusBar style={showWelcome ? 'light' : 'dark'} hidden={hideBars} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="player" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="edit/[id]" />
      </Stack>
      <AddToPlaylistSheet />
      <ConfirmHost />
      {/* La pantalla Reproduciendo (modal) lleva su propio aviso: aquí se oculta para no duplicarlo. */}
      <ToastHost bottom={150} hidden={pathname.startsWith('/player')} />
      {welcome ? <Welcome key={welcome.id} splash={welcome.splash} intro={welcome.intro} onDone={closeWelcome} /> : null}
    </BackgroundPlayerProvider>
  );
}
