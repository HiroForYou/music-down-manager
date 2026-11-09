import { Modal, Pressable, Text, View } from 'react-native';

import { closeConfirm, useConfirmRequest } from '../lib/confirm';
import { colors, fonts } from '../lib/theme';

/** Diálogo central de confirmación: título serif, mensaje y dos botones (Cancelar / acción). */
export function ConfirmHost() {
  const request = useConfirmRequest();
  if (!request) return null;
  const accent = request.destructive !== false;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={closeConfirm}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(20,33,43,0.55)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}
        onPress={closeConfirm}
      >
        {/* El contenido captura el toque para que no cierre el diálogo. */}
        <Pressable
          onPress={() => {}}
          style={{ width: '100%', backgroundColor: colors.bg, borderRadius: 8, padding: 24 }}
        >
          <Text style={{ fontFamily: fonts.serif, fontSize: 22, lineHeight: 26, color: colors.ink }}>{request.title}</Text>
          <Text style={{ marginTop: 8, fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: colors.muted }}>{request.message}</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
            <Pressable
              onPress={closeConfirm}
              style={{ flex: 1, height: 48, borderRadius: 4, borderWidth: 1, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: fonts.sansSemi, fontSize: 14, color: colors.ink }}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const run = request.onConfirm;
                closeConfirm();
                run();
              }}
              style={{ flex: 1, height: 48, borderRadius: 4, backgroundColor: accent ? colors.accent : colors.ink, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: fonts.sansSemi, fontSize: 14, color: colors.white }}>{request.confirmLabel ?? 'Eliminar'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
