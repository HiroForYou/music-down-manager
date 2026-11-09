import { useCallback, useRef, useState } from 'react';
import type { WebViewNavigation } from 'react-native-webview';
import { WebView } from 'react-native-webview';

import { downloadTrack, extractYoutubeVideoId } from '../../lib/download';
import { Button } from '../../lib/tw/Button';
import { Pressable, Text, View } from '../../lib/tw';
import { YOUTUBE_AD_BLOCK_SCRIPT } from '../../lib/youtubeAdBlock';

const HOME_URL = 'https://m.youtube.com';

export default function YoutubeBrowserScreen() {
  const webviewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState(HOME_URL);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCurrentUrl(navState.url);
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
  }, []);

  const goHome = useCallback(() => {
    webviewRef.current?.injectJavaScript(`window.location.href = '${HOME_URL}'; true;`);
  }, []);

  const isYoutubeVideo = extractYoutubeVideoId(currentUrl) !== null;

  const handleDownload = useCallback(async () => {
    setBusy(true);
    setProgress(null);
    setMessage(null);
    try {
      const track = await downloadTrack(currentUrl, (percent) => setProgress(percent));
      setMessage(`"${track.title}" se guardó en Música.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo descargar este video.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [currentUrl]);

  const buttonLabel = busy
    ? progress !== null
      ? `Descargando… ${Math.round(progress)}%`
      : 'Descargando…'
    : 'Descargar este video';

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row items-center gap-1 border-b border-gray-100 px-1 py-1">
        <Pressable className="px-2 py-2" onPress={() => webviewRef.current?.goBack()} disabled={!canGoBack}>
          <Text className={`text-lg ${canGoBack ? 'text-gray-700' : 'text-gray-300'}`}>‹</Text>
        </Pressable>
        <Pressable className="px-2 py-2" onPress={() => webviewRef.current?.goForward()} disabled={!canGoForward}>
          <Text className={`text-lg ${canGoForward ? 'text-gray-700' : 'text-gray-300'}`}>›</Text>
        </Pressable>
        <Pressable className="px-2 py-2" onPress={goHome}>
          <Text className="text-lg text-gray-700">⌂</Text>
        </Pressable>
        <Text className="flex-1 text-xs text-gray-400" numberOfLines={1}>
          {currentUrl}
        </Text>
        <Pressable className="px-2 py-2" onPress={() => webviewRef.current?.reload()}>
          <Text className="text-lg text-gray-700">↻</Text>
        </Pressable>
      </View>
      <WebView
        ref={webviewRef}
        source={{ uri: 'https://m.youtube.com' }}
        onNavigationStateChange={handleNavigationStateChange}
        injectedJavaScript={YOUTUBE_AD_BLOCK_SCRIPT}
        injectedJavaScriptBeforeContentLoaded={YOUTUBE_AD_BLOCK_SCRIPT}
        style={{ flex: 1 }}
      />
      <View className="gap-2 border-t border-gray-100 p-4">
        {message ? <Text className="text-center text-gray-700">{message}</Text> : null}
        {busy && progress !== null ? (
          <View className="h-2 overflow-hidden rounded-full bg-gray-200">
            <View className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.max(2, Math.round(progress))}%` }} />
          </View>
        ) : null}
        <Button label={buttonLabel} onPress={handleDownload} disabled={busy || !isYoutubeVideo} />
      </View>
    </View>
  );
}
