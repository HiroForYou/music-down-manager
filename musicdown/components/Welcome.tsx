import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '../lib/theme';
import { markIntroSeen } from '../lib/welcomePrefs';
import { Button } from './ui';

// Bienvenida: arranca igual que la splash nativa (fondo #14212B + logo) y se anima con suavidad.
// Según Ajustes: `splash` activa la animación de bienvenida y `intro` el carrusel de 3 pasos (se muestra
// mientras no se haya visto). Sin ninguno de los dos, esta pantalla no se monta.

const SPLASH_BG = '#14212B';
const LOGO = require('../assets/splash-icon.png');
// Sobre el fondo claro del carrusel se usa el ícono completo (cuadrado oscuro), porque la M del otro es clara.
const ICON = require('../assets/icon.png');

const STEPS = [
  {
    title: 'Descarga',
    lead: 'Un enlace y listo.',
    body: 'Pega el enlace de un MP3 o de YouTube, o navega YouTube desde la app, y guarda la canción en tu teléfono.',
  },
  {
    title: 'Escucha',
    lead: 'Todo en un solo lugar.',
    body: 'Reproduce tus descargas y tus likes de Spotify con el mismo reproductor, con mini barra siempre a mano.',
  },
  {
    title: 'Organiza',
    lead: 'A tu manera.',
    body: 'Cambia el título, el artista, el álbum y la portada de cada canción, y ordénalas como prefieras.',
  },
];

export function Welcome({ splash, intro, onDone }: { splash: boolean; intro: boolean; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'splash' | 'steps'>(splash ? 'splash' : 'steps');
  const [step, setStep] = useState(0);

  // Splash animada.
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.92)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const wordShift = useRef(new Animated.Value(10)).current;
  const tagOpacity = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  // Pasos.
  const stepsOpacity = useRef(new Animated.Value(splash ? 0 : 1)).current;
  const pagerRef = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(0);

  const finish = useCallback(() => {
    if (intro) markIntroSeen();
    Animated.timing(overlayOpacity, { toValue: 0, duration: 380, useNativeDriver: true }).start(onDone);
  }, [overlayOpacity, onDone, intro]);

  useEffect(() => {
    if (!splash) return;
    let cancelled = false;
    const ease = Easing.out(Easing.cubic);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1, duration: 650, easing: ease, useNativeDriver: true }),
        Animated.timing(logoScale, { toValue: 1, duration: 800, easing: ease, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(wordOpacity, { toValue: 1, duration: 550, easing: ease, useNativeDriver: true }),
        Animated.timing(wordShift, { toValue: 0, duration: 550, easing: ease, useNativeDriver: true }),
      ]),
      Animated.timing(tagOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.delay(650),
    ]).start(() => {
      if (cancelled) return;
      if (!intro) {
        Animated.timing(overlayOpacity, { toValue: 0, duration: 450, useNativeDriver: true }).start(onDone);
      } else {
        setPhase('steps');
        Animated.timing(stepsOpacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [splash, intro, logoOpacity, logoScale, wordOpacity, wordShift, tagOpacity, overlayOpacity, stepsOpacity, onDone]);

  // Ir a una página (botón Continuar); el deslizamiento con el dedo lo resuelve el propio ScrollView.
  const goTo = useCallback(
    (next: number) => {
      pagerRef.current?.scrollTo({ x: next * pageWidth, animated: true });
      setStep(next);
    },
    [pageWidth]
  );

  const onPagerSettled = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth <= 0) return;
      const index = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
      setStep(Math.max(0, Math.min(STEPS.length - 1, index)));
    },
    [pageWidth]
  );

  const last = step === STEPS.length - 1;

  return (
    <Animated.View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: SPLASH_BG, opacity: overlayOpacity }}
    >
      {/* Splash */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }} pointerEvents="none">
        <Animated.Image
          source={LOGO}
          style={{ width: 160, height: 160, opacity: logoOpacity, transform: [{ scale: logoScale }] }}
          resizeMode="contain"
        />
        <View style={{ alignItems: 'center', gap: 12 }}>
          <Animated.Text
            style={{
              opacity: wordOpacity,
              transform: [{ translateY: wordShift }],
              fontFamily: fonts.serif,
              fontSize: 44,
              letterSpacing: -1.3,
              color: colors.bg,
            }}
          >
            Music<Text style={{ fontFamily: fonts.serifItalicSemi, color: '#E0773F' }}>Down</Text>
          </Animated.Text>
          <Animated.Text
            style={{ opacity: tagOpacity, fontFamily: fonts.sansSemi, fontSize: 10, letterSpacing: 1.8, color: '#9FB0BA' }}
          >
            DESCARGA · ESCUCHA · ORGANIZA
          </Animated.Text>
        </View>
      </View>

      {/* Introducción (solo la primera vez) */}
      {phase === 'steps' ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.bg,
            opacity: stepsOpacity,
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
            paddingHorizontal: 28,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 36 }}>
            <Image source={ICON} style={{ width: 36, height: 36, borderRadius: 9 }} resizeMode="cover" />
            {!last ? (
              <Pressable onPress={finish} hitSlop={12}>
                <Text style={{ fontFamily: fonts.sansSemi, fontSize: 14, color: colors.muted }}>Omitir</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={{ flex: 1 }} onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}>
            {pageWidth > 0 ? (
              <ScrollView
                ref={pagerRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                bounces={false}
                overScrollMode="never"
                onMomentumScrollEnd={onPagerSettled}
                style={{ flex: 1 }}
              >
                {STEPS.map((item, i) => (
                  <View key={item.title} style={{ width: pageWidth, justifyContent: 'center' }}>
                    <Text style={{ fontFamily: fonts.serifItalicSemi, fontSize: 22, color: colors.accent }}>{i + 1}</Text>
                    <Text style={{ fontFamily: fonts.serifBold, fontSize: 56, lineHeight: 64, letterSpacing: -1.2, color: colors.ink }}>
                      {item.title}
                    </Text>
                    <Text style={{ marginTop: 4, fontFamily: fonts.serifItalic, fontSize: 18, color: colors.muted }}>{item.lead}</Text>
                    <Text style={{ marginTop: 20, fontFamily: fonts.sans, fontSize: 16, lineHeight: 24, color: colors.ink }}>
                      {item.body}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={{ height: 2, flex: 1, backgroundColor: i <= step ? colors.accent : colors.line }}
              />
            ))}
          </View>
          <Button label={last ? 'Empezar' : 'Continuar'} onPress={() => (last ? finish() : goTo(step + 1))} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
