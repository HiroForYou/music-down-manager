import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Animated, Pressable, Text } from 'react-native';

import { dismissToast, useToast, type ToastMessage } from '../lib/toast';
import { fonts } from '../lib/theme';

/**
 * Aviso inferior: pastilla translúcida de ancho completo con ícono, mensaje y acción opcional ("Deshacer").
 * `bottom` es la distancia al borde inferior de la pantalla donde se monta.
 */
export function ToastHost({ bottom, hidden = false }: { bottom: number; hidden?: boolean }) {
  const toast = useToast();
  const [shown, setShown] = useState<ToastMessage | null>(toast);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (toast) {
      setShown(toast);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setShown(null);
      });
    }
  }, [toast, opacity]);

  if (!shown || hidden) return null;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 24,
        right: 24,
        bottom,
        opacity,
        transform: [{ translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      <Animated.View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderRadius: 12,
          backgroundColor: 'rgba(20, 33, 43, 0.82)',
          shadowColor: '#14212B',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.2,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <Feather name={shown.icon as ComponentProps<typeof Feather>['name']} size={20} color="#FFFFFF" />
        <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.sansSemi, fontSize: 13, color: '#FFFFFF' }}>
          {shown.message}
        </Text>
        {shown.actionLabel ? (
          <Pressable
            hitSlop={10}
            onPress={() => {
              shown.onAction?.();
              dismissToast();
            }}
          >
            <Text
              style={{
                fontFamily: fonts.sansSemi,
                fontSize: 13,
                color: '#F3A978',
                borderBottomWidth: 1,
                borderBottomColor: '#E0773F',
                paddingBottom: 1,
              }}
            >
              {shown.actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}
