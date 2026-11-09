import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { YoutubeBrowser } from '../../components/YoutubeBrowser';
import { Button, Cover, Field, Icon, ScreenTitle, SectionLabel, TextTabs } from '../../components/ui';
import { startDownload, useDownloads, type DownloadItem } from '../../lib/downloads';
import { ServerBanner } from '../../components/ServerBanner';
import { usePowerPrefs } from '../../lib/powerPrefs';
import { useServerStatus } from '../../lib/serverStatus';
import { colors, fonts } from '../../lib/theme';

type Mode = 'link' | 'youtube';

function DownloadRow({ item }: { item: DownloadItem }) {
  const done = item.status === 'done';
  const failed = item.status === 'error';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      <Cover uri={item.coverUri} size={44} seed={item.id} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.serif, fontSize: 16, color: colors.ink }}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.sans, fontSize: 13, color: failed ? colors.accent : colors.muted }}>
          {done ? 'Listo' : failed ? item.error ?? 'Error' : 'Descargando'}
        </Text>
        {item.status === 'downloading' ? (
          <View style={{ height: 2, backgroundColor: colors.line, marginTop: 4 }}>
            <View style={{ height: 2, width: `${Math.max(2, Math.round(item.progress ?? 0))}%`, backgroundColor: colors.accent }} />
          </View>
        ) : null}
      </View>
      {done ? (
        <Icon name="check" size={18} />
      ) : failed ? (
        <Icon name="alert-circle" size={18} color={colors.accent} />
      ) : item.progress !== null ? (
        <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: colors.accent }}>{Math.round(item.progress)}%</Text>
      ) : null}
    </View>
  );
}

export default function DownloadScreen() {
  const insets = useSafeAreaInsets();
  const { items, busy, progress } = useDownloads();
  const serverOnline = useServerStatus() === 'online';
  const offlineMode = usePowerPrefs().offlineMode;
  const [mode, setMode] = useState<Mode>('link');
  const [url, setUrl] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    const value = url.trim();
    if (!value) {
      setHint('Pega un enlace primero.');
      return;
    }
    setHint(null);
    if (await startDownload(value)) setUrl('');
  }, [url]);

  const buttonLabel = busy ? (progress !== null ? `Descargando… ${Math.round(progress)}%` : 'Descargando…') : 'Descargar';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 24 }}>
      <ScreenTitle>Descargar</ScreenTitle>
      <TextTabs
        tabs={[
          { key: 'link', label: 'Enlace' },
          { key: 'youtube', label: 'YouTube' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <ServerBanner />

      <View style={{ flex: 1, display: mode === 'link' ? 'flex' : 'none' }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 16, paddingBottom: 16, gap: 16 }}>
          <View style={{ paddingHorizontal: 24, gap: 12 }}>
            <Field
              label="Pega un enlace"
              value={url}
              onChangeText={(v) => {
                setUrl(v);
                setHint(null);
              }}
              placeholder="MP3 directo o enlace de YouTube"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              size="lg"
            />
            {hint ? <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.accent }}>{hint}</Text> : null}
            <Button label={buttonLabel} onPress={handleDownload} disabled={busy || !serverOnline} tone={busy ? colors.inkSoft : colors.ink} />
          </View>
          {items.length > 0 ? (
            <View style={{ gap: 4 }}>
              <SectionLabel>Descargas</SectionLabel>
              <View style={{ paddingHorizontal: 24 }}>
                {items.map((item) => (
                  <DownloadRow key={item.id} item={item} />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>

      <View style={{ flex: 1, display: mode === 'youtube' ? 'flex' : 'none' }}>
        {offlineMode ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Text style={{ fontFamily: fonts.serifItalic, fontSize: 16, textAlign: 'center', color: colors.muted }}>
              Modo sin conexión activado: YouTube no está disponible. Desactívalo en Ajustes → Batería.
            </Text>
          </View>
        ) : (
          <YoutubeBrowser />
        )}
      </View>

    </View>
  );
}
