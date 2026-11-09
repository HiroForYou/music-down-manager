import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { WebViewNavigation } from 'react-native-webview';
import { WebView } from 'react-native-webview';

import { extractYoutubeVideoId } from '../lib/download';
import { startDownload, useDownloads } from '../lib/downloads';
import { useServerStatus } from '../lib/serverStatus';
import { colors, fonts } from '../lib/theme';
import { YOUTUBE_AD_BLOCK_SCRIPT } from '../lib/youtubeAdBlock';
import { YOUTUBE_BACKGROUND_PLAY_SCRIPT } from '../lib/youtubeBackgroundPlay';
import { Button, Icon, type IconName } from './ui';

const HOME_URL = 'https://m.youtube.com';

function NavButton({ name, onPress, disabled }: { name: IconName; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} style={{ padding: 6 }}>
      <Icon name={name} size={20} color={disabled ? colors.faint : colors.ink} />
    </Pressable>
  );
}

export function YoutubeBrowser() {
  const webviewRef = useRef<WebView>(null);
  const { busy, progress } = useDownloads();
  const serverOnline = useServerStatus() === 'online';
  const [currentUrl, setCurrentUrl] = useState(HOME_URL);
  const [pageTitle, setPageTitle] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCurrentUrl(navState.url);
    setCanGoBack(navState.canGoBack);
    setPageTitle(navState.title ?? '');
  }, []);

  const goHome = useCallback(() => {
    webviewRef.current?.injectJavaScript(`window.location.href = '${HOME_URL}'; true;`);
  }, []);

  const isYoutubeVideo = extractYoutubeVideoId(currentUrl) !== null;

  const label = busy
    ? progress !== null
      ? `Descargando… ${Math.round(progress)}%`
      : 'Descargando…'
    : 'Descargar este video';

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginHorizontal: 24,
          marginTop: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.ink,
          paddingBottom: 6,
        }}
      >
        <NavButton name="chevron-left" onPress={() => webviewRef.current?.goBack()} disabled={!canGoBack} />
        <NavButton name="home" onPress={goHome} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.sans, fontSize: 13, color: colors.muted }}>
          {currentUrl.replace(/^https?:\/\//, '')}
        </Text>
        <NavButton name="rotate-cw" onPress={() => webviewRef.current?.reload()} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 24, marginTop: 12, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.cover }}>
        <WebView
          ref={webviewRef}
          source={{ uri: HOME_URL }}
          onNavigationStateChange={handleNavigationStateChange}
          injectedJavaScript={YOUTUBE_AD_BLOCK_SCRIPT}
          injectedJavaScriptBeforeContentLoaded={YOUTUBE_BACKGROUND_PLAY_SCRIPT + YOUTUBE_AD_BLOCK_SCRIPT}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          style={{ flex: 1, backgroundColor: colors.cover }}
        />
      </View>
      {isYoutubeVideo && pageTitle ? (
        <Text numberOfLines={1} style={{ marginHorizontal: 24, marginTop: 12, fontFamily: fonts.serifBold, fontSize: 18, color: colors.ink }}>
          {pageTitle.replace(/ - YouTube$/, '')}
        </Text>
      ) : null}
      <View style={{ padding: 24, paddingBottom: 16 }}>
        <Button
          label={label}
          onPress={() => startDownload(currentUrl)}
          disabled={busy || !isYoutubeVideo || !serverOnline}
          tone={busy ? colors.inkSoft : colors.ink}
        />
      </View>
    </View>
  );
}
