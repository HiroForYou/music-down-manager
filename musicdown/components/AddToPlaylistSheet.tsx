import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { closeAddToPlaylist, useAddToPlaylistRequest } from '../lib/playlistSheet';
import { showToast } from '../lib/toast';
import { addEntries, createPlaylist, deletePlaylist, LIKED_ID, removeEntry, usePlaylists } from '../lib/playlists';
import { colors, fonts } from '../lib/theme';
import { HeartIcon, Icon } from './ui';

/** Hoja inferior para agregar una o varias canciones a una lista (o crear una nueva). */
export function AddToPlaylistSheet() {
  const insets = useSafeAreaInsets();
  const entries = useAddToPlaylistRequest();
  const { playlists } = usePlaylists();
  const [name, setName] = useState('');

  useEffect(() => {
    if (entries) {
      setName('');
    }
  }, [entries]);

  if (!entries) return null;
  const single = entries.length === 1 ? entries[0] : null;

  // La confirmación sale como aviso breve sobre la pantalla de origen.
  const finish = (text: string, icon = 'plus-circle', undo?: () => void) => {
    closeAddToPlaylist();
    showToast(text, icon, undo ? { actionLabel: 'Deshacer', onAction: undo } : {});
  };

  const onPick = (id: string, listName: string, contains: boolean) => {
    if (single && contains) {
      removeEntry(id, single.key);
      finish(`Quitada de “${listName}”`, 'minus-circle', () => {
        addEntries(id, [single]);
      });
      return;
    }
    const list = playlists.find((p) => p.id === id);
    const have = new Set((list?.entries ?? []).map((e) => e.key));
    const fresh = entries.filter((e) => !have.has(e.key));
    addEntries(id, entries);
    if (fresh.length === 0) {
      finish(`Ya estaba en “${listName}”`, 'info');
      return;
    }
    const where = id === LIKED_ID ? 'tus me gusta' : `“${listName}”`;
    finish(`Agregada${fresh.length > 1 ? 's' : ''} a ${where}`, 'plus-circle', () => {
      fresh.forEach((e) => removeEntry(id, e.key));
    });
  };

  const onCreate = () => {
    const id = createPlaylist(name);
    addEntries(id, entries);
    finish(`Agregada a “${name.trim() || 'Nueva lista'}”`, 'plus-circle', () => deletePlaylist(id));
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={closeAddToPlaylist}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,33,43,0.4)' }} onPress={closeAddToPlaylist} />
        <View style={{ maxHeight: '75%', backgroundColor: colors.bg, paddingHorizontal: 24, paddingTop: 20, paddingBottom: insets.bottom + 16 }}>
          <Text style={{ fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 1.4, color: colors.muted, marginBottom: 10 }}>
            {entries.length > 1 ? `AGREGAR ${entries.length} CANCIONES A` : 'AGREGAR A UNA LISTA'}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.ink }}>
            <Icon name="plus" size={18} />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Nueva lista"
              placeholderTextColor={colors.faint}
              onSubmitEditing={onCreate}
              returnKeyType="done"
              style={{ flex: 1, paddingVertical: 12, fontFamily: fonts.sans, fontSize: 16, color: colors.ink }}
            />
            {name.trim() ? (
              <Pressable onPress={onCreate} hitSlop={8}>
                <Text style={{ fontFamily: fonts.sansSemi, fontSize: 14, color: colors.accent }}>Crear</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 6 }}>
            {playlists.map((p) => {
              const have = new Set(p.entries.map((e) => e.key));
              const contains = entries.every((e) => have.has(e.key));
              return (
                <Pressable
                  key={p.id}
                  onPress={() => onPick(p.id, p.name, contains)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line }}
                >
                  {p.id === LIKED_ID ? <HeartIcon filled size={18} /> : <Icon name="list" size={18} />}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.serif, fontSize: 18, color: colors.ink }}>
                      {p.name}
                    </Text>
                    <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.muted }}>
                      {p.entries.length} {p.entries.length === 1 ? 'canción' : 'canciones'}
                    </Text>
                  </View>
                  {contains ? <Icon name="check" size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>

        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
