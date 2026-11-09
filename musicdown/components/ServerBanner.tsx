import { Pressable, Text, View } from 'react-native';

import { checkServer, SERVER_STATUS_TEXT, useServerStatus } from '../lib/serverStatus';
import { colors, fonts } from '../lib/theme';
import { Icon, LoadingDots } from './ui';

const HINTS = {
  offline: 'Las descargas y la sincronización están desactivadas. Lo ya descargado sigue sonando.',
  unauthorized: 'Revisa la "Clave de acceso" en Ajustes.',
  unconfigured: 'Escribe la URL de tu servidor en Ajustes.',
  disabled: 'No se usa internet ni el servidor. Desactívalo en Ajustes → Batería para descargar y sincronizar.',
} as const;

/** Aviso cuando el servidor no está disponible: explica qué queda desactivado y permite reintentar. */
export function ServerBanner() {
  const status = useServerStatus();
  if (status === 'online' || status === 'unknown') return null;

  const checking = status === 'checking';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginHorizontal: 24,
        marginTop: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 4,
        backgroundColor: 'rgba(168,66,14,0.10)',
      }}
    >
      {checking ? <LoadingDots size={4} /> : <Icon name="wifi-off" size={16} color={colors.accent} />}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: colors.ink }}>{SERVER_STATUS_TEXT[status]}</Text>
        {!checking && status in HINTS ? (
          <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.muted }}>{HINTS[status as keyof typeof HINTS]}</Text>
        ) : null}
      </View>
      {!checking && status !== 'disabled' ? (
        <Pressable onPress={() => checkServer()} hitSlop={8}>
          <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: colors.accent, borderBottomWidth: 1, borderBottomColor: colors.accent }}>
            Reintentar
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
