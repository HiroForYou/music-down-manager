export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUri: string | null;
  fileUri: string;
  mediaAssetId: string | null;
  sourceUrl: string;
  createdAt: number;
  /** Id del like de Spotify del que viene esta descarga (si aplica). */
  spotifyId?: string;
  /** true: el archivo de la canción ya vive en la carpeta Música del teléfono (como .mp3), no en el almacenamiento privado. */
  inMusic?: boolean;
}
