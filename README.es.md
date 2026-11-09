# app-mp3-download

[English](README.md) · Español

Monorepo de MusicDown: app Android para descargar, reproducir y organizar música, un servidor autohospedado que convierte enlaces de YouTube a MP3 y una extensión de Spotify de escritorio que sincroniza los "Me gusta".

## Componentes

| Carpeta | Descripción | Stack |
|---|---|---|
| `musicdown/` | App móvil (Android principal) | Expo SDK 54, React Native 0.81, Expo Router, NativeWind 5 |
| `server/` | API de conversión, streaming, likes de Spotify y respaldo de biblioteca | Node.js, Express, `yt-dlp`, `ffmpeg` |
| `spicetify/` | Extensión que envía los likes de Spotify al servidor y aplica las bajas hechas desde la app | Spicetify |
| `docs/` | Referencia de funcionalidades ([FEATURES.md](docs/FEATURES.md)) y maquetas de UI ([design/](docs/design/)) | - |

```
Spotify escritorio ──(spicetify)──► server ◄──── app MusicDown
                                      │
                               yt-dlp + ffmpeg
```

## Funcionalidades de la app

| Pestaña / pantalla | Funcionalidad |
|---|---|
| Música | Biblioteca local ("Mis descargas" y carpeta Música del teléfono), búsqueda, orden, selección múltiple, listas |
| Spotify | Likes con caché sin conexión, búsqueda, reproducción por streaming vía servidor, descarga a la biblioteca |
| Descargar | Descarga por enlace (MP3 directo o YouTube) y navegador de YouTube integrado con bloqueo básico de anuncios |
| Reproduciendo | Reproductor global con cola, letras sincronizadas (LRCLIB) y fondo según el color de la portada |
| Editar canción | Título, artista, álbum y portada (galería o búsqueda en iTunes); escribe ID3 en el archivo |
| Ajustes | Servidor y clave de acceso, privacidad, ahorro de energía, modo sin conexión, temas |
| Widgets Android | 9 variantes de "Reproduciendo" (4×1, 4×2, 4×4, 2×2; opaco, semitraslúcido, transparente) |

| Comportamiento | Detalle |
|---|---|
| Privacidad | Activa por defecto. Las descargas se guardan en almacenamiento privado con extensión `.zc3` y no aparecen en otras apps. Al compartir se entrega una copia `.mp3`. |
| Respaldo | Listas y "Me gustan" se copian al servidor tras cada cambio. Una instalación nueva restaura el respaldo. |
| Segundo plano | Un audio silencioso con notificación multimedia mantiene la app activa durante descargas largas. |
| Modo sin conexión | Sin servidor ni internet; solo reproduce lo descargado. |

Detalle completo: [docs/FEATURES.md](docs/FEATURES.md).

## Requisitos

| Componente | Requisito |
|---|---|
| `server/` | Node.js 22+, pnpm 11, `yt-dlp` y `ffmpeg` en `PATH`. Opcional: `cloudflared` para acceso público. |
| `musicdown/` | Node.js 22, pnpm 11, cuenta de Expo (EAS) para builds |
| `spicetify/` | Spotify de escritorio con [Spicetify](https://spicetify.app) instalado |

Los builds de EAS usan Node 22.13 (`musicdown/eas.json`); la imagen Docker del servidor usa `node:22-slim`.

## Puesta en marcha

### 1. Servidor

```bash
cd server
pnpm install
cp .env.example .env      # definir ACCESS_KEY
pnpm start                # solo red local, puerto 3008
pnpm start:tunnel         # red local + URL https pública (Cloudflare quick tunnel)
```

La URL del túnel cambia en cada arranque. Endpoints, variables de entorno y Docker: [server/README.es.md](server/README.es.md).

### 2. App móvil

La app usa módulos nativos (widgets, WebView parcheada), por lo que no funciona en Expo Go. Requiere un build de desarrollo:

```bash
cd musicdown
pnpm install
npx eas-cli build --profile development --platform android   # instalar el APK resultante
npx expo start --dev-client
```

APK instalable sin servidor de desarrollo:

```bash
npx eas-cli build --profile preview --platform android
```

En la app: Ajustes, URL del servidor y clave de acceso (mismo valor que `ACCESS_KEY`), luego "Probar conexión".

### 3. Extensión de Spotify (opcional)

```bash
# Copiar spicetify/musicdown-likes.js a la carpeta Extensions de Spicetify y luego:
spicetify config extensions musicdown-likes.js
spicetify apply
```

La URL del servidor y la clave se configuran en el menú de perfil de Spotify, opción "Musicdown: ajustes". El botón de la barra superior fuerza una sincronización.

## Parches de dependencias

Definidos en `musicdown/pnpm-workspace.yaml` y aplicados por pnpm al instalar.

| Paquete | Archivo |
|---|---|
| `expo-audio@1.1.1` | `patches/expo-audio@1.1.1.patch` |
| `expo-media-library` | `patches/expo-media-library.patch` |
| `react-native-webview@13.15.0` | `patches/react-native-webview@13.15.0.patch` |

Actualizar cualquiera de estos paquetes obliga a regenerar su parche.

## Licencia

[MIT](LICENSE). Cubre solo el código de este repositorio. `yt-dlp`, `ffmpeg` y Spicetify son herramientas externas con licencia propia.

## Aviso legal

Uso personal y autohospedado. Descargar audio de YouTube puede infringir sus Términos de Servicio según el contenido y la jurisdicción. No exponer el servidor como servicio público para terceros.
