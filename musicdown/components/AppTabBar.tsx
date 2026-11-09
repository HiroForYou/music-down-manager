import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBackgroundPlayer, type PlayerStatus } from '../lib/backgroundPlayer';
import { colors, fonts } from '../lib/theme';
import { Cover, Icon, LoadingDots } from './ui';

export const STATUS_LABELS: Record<PlayerStatus, string> = {
  idle: '',
  loading: 'Buscando audio…',
  ad: 'Anuncio…',
  playing: 'Reproduciendo',
  paused: 'En pausa',
  error: 'Error',
};

function MiniPlayer() {
  const router = useRouter();
  const player = useBackgroundPlayer();
  const track = player.current;
  if (!track) return null;
  const progress = player.duration > 0 ? Math.min(100, (player.position / player.duration) * 100) : 0;
  const isPlaying = player.status === 'playing' || player.status === 'ad' || player.status === 'loading';

  return (
    <Pressable
      onPress={() => router.push('/player')}
      style={{ borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg }}
    >
      <View style={{ height: 2, marginTop: -1, width: `${progress}%`, backgroundColor: colors.accent }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 10 }}>
        <Cover uri={track.image} size={40} seed={track.id} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.serif, fontSize: 15, color: colors.ink }}>
            {track.title} · {track.artist}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.sans, fontSize: 12, color: colors.muted }}>
              {player.status === 'error' ? player.error : STATUS_LABELS[player.status]}
            </Text>
            {player.status === 'loading' ? <LoadingDots size={4} color={colors.muted} /> : null}
          </View>
        </View>
        <Pressable onPress={player.togglePlay} hitSlop={8} style={{ padding: 8 }}>
          <Icon name={isPlaying ? 'pause' : 'play'} size={20} />
        </Pressable>
        <Pressable onPress={player.next} hitSlop={8} style={{ padding: 8 }}>
          <Icon name="skip-forward" size={20} />
        </Pressable>
      </View>
    </Pressable>
  );
}

// Barra inferior del diseño: mini reproductor + pestañas de solo texto con indicador terracota.
export function AppTabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: colors.bg }}>
      <MiniPlayer />
      <View
        style={{
          flexDirection: 'row',
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingBottom: insets.bottom,
        }}
      >
        {state.routes.map((route: any, i: number) => {
          const focused = state.index === i;
          const label = descriptors[route.key].options.title ?? route.name;
          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              style={{ flex: 1, alignItems: 'center' }}
            >
              <View style={{ height: 2, width: '100%', marginTop: -1, backgroundColor: focused ? colors.accent : 'transparent' }} />
              <Text
                style={{
                  paddingVertical: 16,
                  fontFamily: focused ? fonts.sansSemi : fonts.sansMedium,
                  fontSize: 14,
                  color: colors.ink,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
