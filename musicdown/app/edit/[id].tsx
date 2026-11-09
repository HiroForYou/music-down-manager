import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Cover, Field, Icon } from '../../components/ui';
import { deleteTrack, downloadImageBytes, updateTrackMetadata } from '../../lib/download';
import { searchCovers, type CoverResult } from '../../lib/itunes';
import { getTrack } from '../../lib/library';
import { shareTrack } from '../../lib/share';
import { colors, fonts } from '../../lib/theme';
import type { Track } from '../../lib/types';

type PendingCover = { kind: 'remote'; url: string } | { kind: 'local'; uri: string };

function LinkAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={{ fontFamily: fonts.sansSemi, fontSize: 15, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function EditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [track, setTrack] = useState<Track | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [pendingCover, setPendingCover] = useState<PendingCover | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');

  const [coverSearchOpen, setCoverSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CoverResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const found = await getTrack(id);
      if (!found) {
        router.back();
        return;
      }
      setTrack(found);
      setTitle(found.title);
      setArtist(found.artist);
      setAlbum(found.album);
      setPreviewUri(found.coverUri);
      setQuery(`${found.artist} ${found.title}`.trim());
    })();
  }, [id, router]);

  const pickFromGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Se necesita permiso para acceder a tus fotos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setPendingCover({ kind: 'local', uri });
    setPreviewUri(uri);
  }, []);

  const runSearch = useCallback(async () => {
    setSearching(true);
    setError(null);
    try {
      setResults(await searchCovers(query));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La búsqueda falló.');
    } finally {
      setSearching(false);
    }
  }, [query]);

  const selectCover = useCallback((result: CoverResult) => {
    setPendingCover({ kind: 'remote', url: result.artworkUrl });
    setPreviewUri(result.artworkUrl);
    setCoverSearchOpen(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!track) return;
    setBusy(true);
    setError(null);
    try {
      let coverBytes: Uint8Array | undefined;
      if (pendingCover?.kind === 'remote') {
        const bytes = await downloadImageBytes(pendingCover.url);
        if (bytes) coverBytes = bytes;
      } else if (pendingCover?.kind === 'local') {
        coverBytes = await new File(pendingCover.uri).bytes();
      }
      await updateTrackMetadata(track.id, {
        title: title.trim() || track.title,
        artist: artist.trim() || track.artist,
        album: album.trim(),
        coverBytes,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }, [track, pendingCover, title, artist, album, router]);

  const handleShare = useCallback(async () => {
    if (!track) return;
    try {
      await shareTrack({ title: title.trim() || track.title, artist: artist.trim() || track.artist, fileUri: track.fileUri });
    } catch (e) {
      Alert.alert('No se pudo compartir', e instanceof Error ? e.message : String(e));
    }
  }, [track, title, artist]);

  const handleDelete = useCallback(() => {
    if (!track) return;
    Alert.alert('Eliminar canción', `¿Eliminar "${track.title}"? Esta acción no se puede deshacer.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await deleteTrack(track.id);
          router.back();
        },
      },
    ]);
  }, [track, router]);

  if (!track) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <Text style={{ fontFamily: fonts.serifItalic, fontSize: 15, color: colors.muted }}>Cargando…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, height: 44 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="chevron-left" size={26} />
        </Pressable>
        <Text style={{ fontFamily: fonts.sansSemi, fontSize: 12, letterSpacing: 1.4, color: colors.muted }}>EDITAR CANCIÓN</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <Pressable onPress={handleShare} hitSlop={12}>
            <Icon name="share-2" size={21} />
          </Pressable>
          <Pressable onPress={handleDelete} hitSlop={12}>
            <Icon name="trash-2" size={22} color={colors.accent} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 22 }}>
        <View style={{ alignItems: 'center', gap: 16 }}>
          <Cover uri={previewUri} size={160} seed={track.id} radius={4} />
          <View style={{ flexDirection: 'row', gap: 24 }}>
            <LinkAction label="Galería" onPress={pickFromGallery} />
            <LinkAction label="Buscar en iTunes" onPress={() => setCoverSearchOpen(true)} />
          </View>
        </View>
        <Field label="Título" value={title} onChangeText={setTitle} />
        <Field label="Artista" value={artist} onChangeText={setArtist} />
        <Field label="Álbum (opcional)" value={album} onChangeText={setAlbum} placeholder="Sin álbum" />
        {error ? <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.accent }}>{error}</Text> : null}
      </ScrollView>

      <View style={{ paddingHorizontal: 24 }}>
        <Button label={busy ? 'Guardando…' : 'Guardar'} onPress={handleSave} disabled={busy} />
      </View>

      <Modal visible={coverSearchOpen} animationType="slide" transparent onRequestClose={() => setCoverSearchOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,33,43,0.4)' }} onPress={() => setCoverSearchOpen(false)} />
          <View style={{ maxHeight: '75%', gap: 14, backgroundColor: colors.bg, paddingHorizontal: 24, paddingTop: 20, paddingBottom: insets.bottom + 16 }}>
            <Field label="Artista - título" value={query} onChangeText={setQuery} onSubmitEditing={runSearch} returnKeyType="search" />
            <Button label={searching ? 'Buscando…' : 'Buscar'} onPress={runSearch} disabled={searching} />
            <FlatList
              style={{ flexGrow: 0 }}
              data={results}
              keyExtractor={(result) => result.id}
              initialNumToRender={8}
              windowSize={5}
              removeClippedSubviews
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={{ paddingVertical: 16, textAlign: 'center', fontFamily: fonts.serifItalic, color: colors.muted }}>Busca un álbum</Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => selectCover(item)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}
                >
                  <Image source={{ uri: item.thumbnailUrl }} style={{ width: 44, height: 44, borderRadius: 3 }} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.serif, fontSize: 16, color: colors.ink }}>{item.title}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.muted }}>{item.artist}</Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
