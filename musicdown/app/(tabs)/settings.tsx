import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Field, Icon, LoadingDots, ScreenTitle, SectionLabel } from '../../components/ui';
import { showToast } from '../../lib/toast';
import { useBackgroundPlayer } from '../../lib/backgroundPlayer';
import { setHideSystemBars, useHideSystemBars } from '../../lib/display';
import { setHideDownloads, useHideDownloads } from '../../lib/privacy';
import { clearLibrary, moveTracksToMusic } from '../../lib/download';
import { listTracks } from '../../lib/library';
import { checkServer, SERVER_STATUS_TEXT, useServerStatus } from '../../lib/serverStatus';
import { getServerSettings, setServerSettings } from '../../lib/settings';
import { setOfflineMode, setSaveEnergy, usePowerPrefs } from '../../lib/powerPrefs';
import { setCoverBackground, setTintIntensity, useThemePrefs, type TintIntensity } from '../../lib/themePrefs';
import { setOpenOnLongPress, setStreamFromServer, useSpotifyPrefs } from '../../lib/spotifyPrefs';
import { requestIntroNow, setShowIntro, setShowSplash, useWelcomePrefs } from '../../lib/welcomePrefs';
import { colors, fonts } from '../../lib/theme';

function SwitchRow({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginHorizontal: 24,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: colors.line,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.sansSemi, fontSize: 15, color: colors.ink }}>{title}</Text>
        <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.muted }}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.line, true: colors.ink }}
        thumbColor={value ? colors.accent : colors.white}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { stop } = useBackgroundPlayer();
  const hideBars = useHideSystemBars();
  const hideDownloads = useHideDownloads();
  const serverStatus = useServerStatus();
  const welcome = useWelcomePrefs();
  const spotifyPrefs = useSpotifyPrefs();
  const power = usePowerPrefs();
  const theme = useThemePrefs();
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const settings = await getServerSettings();
      setServerUrl(settings.serverUrl);
      setApiKey(settings.apiKey);
    })();
  }, []);

  const flash = useCallback((message: string, error = false) => {
    showToast(message, error ? 'alert-circle' : 'check');
  }, []);

  const testConnection = useCallback(async () => {
    const base = serverUrl.trim().replace(/\/+$/, '');
    if (!base) {
      flash('Ingresa una URL primero.', true);
      return;
    }
    setTesting(true);
    try {
      const response = await fetch(`${base}/api/health`, { headers: apiKey ? { 'x-api-key': apiKey } : undefined });
      if (response.ok) flash('Conexión exitosa.');
      else flash(`El servidor respondió con error ${response.status}.`, true);
    } catch {
      flash('No se pudo conectar al servidor.', true);
    } finally {
      setTesting(false);
    }
  }, [serverUrl, apiKey, flash]);

  const handleSave = useCallback(async () => {
    await setServerSettings({ serverUrl, apiKey });
    // Con los datos nuevos se vuelve a hacer ping para habilitar o deshabilitar las opciones del servidor.
    const result = await checkServer();
    flash(result === 'online' ? 'Guardado. Servidor conectado.' : `Guardado. ${SERVER_STATUS_TEXT[result]}.`, result !== 'online');
  }, [serverUrl, apiKey, flash]);

  const handleClearLibrary = useCallback(() => {
    Alert.alert('Borrar todo', '¿Eliminar todas las canciones descargadas? Esta acción no se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar todo',
        style: 'destructive',
        onPress: async () => {
          setClearing(true);
          try {
            stop();
            await clearLibrary();
            flash('Descargas eliminadas.');
          } finally {
            setClearing(false);
          }
        },
      },
    ]);
  }, [stop, flash]);

  const handleMoveAll = useCallback(async () => {
    const pending = (await listTracks()).filter((t) => !t.inMusic);
    if (pending.length === 0) {
      flash('Todas tus descargas ya están en Música.');
      return;
    }
    Alert.alert(
      'Mover todo a Música',
      `Se guardarán ${pending.length} canciones como archivos .mp3 en la carpeta Música del teléfono (ya no estarán ocultas y otras apps podrán verlas). Seguirán en tu biblioteca.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Mover',
          onPress: async () => {
            setMoving(`0 / ${pending.length}`);
            try {
              const r = await moveTracksToMusic(
                pending.map((t) => t.id),
                (done, total) => setMoving(`${done} / ${total}`)
              );
              if (r.errors.length > 0 || r.keptCopy > 0) {
                Alert.alert(
                  'Mover a Música',
                  `${r.moved} movida(s)${r.keptCopy ? ` · ${r.keptCopy} publicada(s) con copia` : ''}${r.errors.length ? ` · ${r.errors.length} con error` : ''}.${
                    r.errors.length ? `\n\n${r.errors.slice(0, 5).join('\n')}` : ''
                  }`
                );
              } else {
                flash(`${r.moved} canciones movidas a Música.`);
              }
            } catch (e) {
              flash(e instanceof Error ? e.message : 'No se pudo mover.', true);
            } finally {
              setMoving(null);
            }
          },
        },
      ]
    );
  }, [flash]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 24 }}>
      <ScreenTitle>Ajustes</ScreenTitle>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 18, paddingBottom: 24 }}>
        <SectionLabel>Conversión de YouTube</SectionLabel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, marginTop: -8 }}>
          {serverStatus === 'checking' ? (
            <LoadingDots size={4} />
          ) : (
            <View
              style={{
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: serverStatus === 'online' ? '#2E7D5B' : serverStatus === 'unknown' ? colors.faint : colors.accent,
              }}
            />
          )}
          <Text style={{ flex: 1, fontFamily: fonts.sansMedium, fontSize: 13, color: colors.ink }}>{SERVER_STATUS_TEXT[serverStatus]}</Text>
          <Pressable onPress={() => checkServer()} hitSlop={8} disabled={serverStatus === 'checking'}>
            <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.ink }}>
              Comprobar
            </Text>
          </Pressable>
        </View>
        <View style={{ paddingHorizontal: 24, gap: 16 }}>
          <Field
            label="Servidor"
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://tu-servidor.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Field
            label="Clave de acceso (opcional)"
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
            <Button
              label={testing ? 'Probando…' : 'Probar conexión'}
              variant="outline"
              onPress={testConnection}
              disabled={testing}
              style={{ flex: 1, height: 48 }}
            />
            <Button label="Guardar" onPress={handleSave} style={{ flex: 1, height: 48 }} />
          </View>
        </View>

        <SectionLabel style={{ marginTop: 6 }}>Pantalla</SectionLabel>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            marginHorizontal: 24,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: colors.line,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.sansSemi, fontSize: 15, color: colors.ink }}>Ocultar barras del sistema</Text>
            <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.muted }}>
              Barra de notificaciones y de navegación. Desliza desde el borde para verlas.
            </Text>
          </View>
          <Switch
            value={hideBars}
            onValueChange={setHideSystemBars}
            trackColor={{ false: colors.line, true: colors.ink }}
            thumbColor={hideBars ? colors.accent : colors.white}
          />
        </View>

        <SectionLabel style={{ marginTop: 6 }}>Temas</SectionLabel>
        <SwitchRow
          title="Fondo según la portada"
          subtitle="En Reproduciendo, el fondo toma un tono parecido al de la portada de la canción. Siempre queda claro para que el texto se lea."
          value={theme.coverBackground}
          onChange={setCoverBackground}
        />
        {theme.coverBackground ? (
          <View style={{ marginHorizontal: 24, marginTop: -6, gap: 8 }}>
            <Text style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: colors.muted }}>Intensidad del color</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {([
                ['soft', 'Suave'],
                ['medium', 'Media'],
                ['strong', 'Fuerte'],
              ] as [TintIntensity, string][]).map(([value, label]) => {
                const active = theme.intensity === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setTintIntensity(value)}
                    style={{
                      flex: 1,
                      height: 40,
                      borderRadius: 4,
                      borderWidth: 1,
                      borderColor: active ? colors.ink : colors.line,
                      backgroundColor: active ? colors.ink : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: active ? colors.white : colors.ink }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <SectionLabel style={{ marginTop: 6 }}>Batería</SectionLabel>
        <SwitchRow
          title="Ahorro de energía"
          subtitle="Mientras suena música, la barra de progreso se actualiza cada 2 s en vez de cada 1 s y las animaciones (ecualizador, puntos de carga) quedan quietas. Con la pantalla apagada la app nunca actualiza la interfaz, tengas esto activado o no."
          value={power.saveEnergy}
          onChange={setSaveEnergy}
        />
        <SwitchRow
          title="Modo sin conexión"
          subtitle="La app no usa internet ni el servidor: no hace ping, no sincroniza ni descarga, no busca letras nuevas ni portadas, y no abre YouTube. Solo suena lo que ya está en el teléfono (las canciones de Spotify sin descargar no suenan). Ahorra batería y datos."
          value={power.offlineMode}
          onChange={setOfflineMode}
        />

        <SectionLabel style={{ marginTop: 6 }}>Spotify</SectionLabel>
        <SwitchRow
          title="Mantener pulsado abre Spotify"
          subtitle="Al mantener pulsada una canción de la pestaña Spotify, la abre en la app de Spotify. Desactivado: mantener pulsado inicia la selección múltiple."
          value={spotifyPrefs.openOnLongPress}
          onChange={setOpenOnLongPress}
        />
        <SwitchRow
          title="Streaming desde el servidor"
          subtitle="Los likes sin descargar suenan desde tu servidor (con controles de bloqueo y widget completos). Solo se usa si el servidor está conectado; si no, o si está desactivado, suenan con el YouTube de la app."
          value={spotifyPrefs.streamFromServer}
          onChange={setStreamFromServer}
        />

        <SectionLabel style={{ marginTop: 6 }}>Bienvenida</SectionLabel>
        <View style={{ gap: 10 }}>
          <SwitchRow
            title="Pantalla de bienvenida"
            subtitle="Animación con el logo al abrir la app."
            value={welcome.showSplash}
            onChange={setShowSplash}
          />
          <SwitchRow
            title="Carrusel de introducción"
            subtitle="Los 3 pasos (Descarga, Escucha, Organiza). Al activarlo se muestra en el próximo inicio."
            value={welcome.showIntro}
            onChange={setShowIntro}
          />
          <Pressable
            onPress={requestIntroNow}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 24, paddingVertical: 8 }}
          >
            <Icon name="play-circle" size={18} />
            <Text style={{ fontFamily: fonts.sansSemi, fontSize: 15, color: colors.ink }}>Ver introducción ahora</Text>
          </Pressable>
        </View>

        <SectionLabel style={{ marginTop: 6 }}>Privacidad</SectionLabel>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            marginHorizontal: 24,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: colors.line,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.sansSemi, fontSize: 15, color: colors.ink }}>Ocultar mis descargas a otras apps</Text>
            <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.muted }}>
              Guarda las canciones nuevas en el almacenamiento privado de MusicDown con otra extensión (.zc3), sin publicarlas en Música ni en la galería. Siguen sonando igual aquí. Al desactivarlo, las nuevas se guardan como MP3 normales.
            </Text>
          </View>
          <Switch
            value={hideDownloads}
            onValueChange={setHideDownloads}
            trackColor={{ false: colors.line, true: colors.ink }}
            thumbColor={hideDownloads ? colors.accent : colors.white}
          />
        </View>

        <SectionLabel style={{ marginTop: 6 }}>Almacenamiento</SectionLabel>
        <Pressable
          onPress={handleMoveAll}
          disabled={moving !== null}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            marginHorizontal: 24,
            paddingVertical: 16,
            borderTopWidth: 1,
            borderColor: colors.line,
            opacity: moving !== null ? 0.5 : 1,
          }}
        >
          <Icon name="folder" size={18} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.sansSemi, fontSize: 15, color: colors.ink }}>
              {moving !== null ? `Moviendo a Música… ${moving}` : 'Mover mis descargas a Música'}
            </Text>
            <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.muted }}>
              Las guarda como .mp3 en la carpeta Música del teléfono. También puedes mover solo algunas: mantén pulsadas en Música y toca la carpeta.
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={handleClearLibrary}
          disabled={clearing}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            marginHorizontal: 24,
            paddingVertical: 16,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: colors.line,
            opacity: clearing ? 0.5 : 1,
          }}
        >
          <Icon name="trash-2" size={18} color={colors.accent} />
          <Text style={{ fontFamily: fonts.sansSemi, fontSize: 15, color: colors.accent }}>
            {clearing ? 'Borrando…' : 'Borrar todas las descargas'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
