# MusicDown: funcionalidades

App móvil (Expo / React Native, Android principal) para descargar, reproducir y organizar música. Idioma de la interfaz: español. Maquetas de referencia en [design/](design/): una imagen por pestaña (`01-musica.png` a `07-ajustes.png`), prototipos HTML (`diseno-minimalista.html`, `logo.html`) e iteraciones de Reproduciendo (`reproduciendo/`).

## Navegación

| Elemento | Detalle |
|---|---|
| Pestañas inferiores | Música · Spotify · Descargar · Ajustes |
| Barra inferior | Mini reproductor global sobre las pestañas (portada, título, anterior/pausa/siguiente) |
| Pantallas apiladas | Reproduciendo (`/player`), Editar canción (`/edit/[id]`) |
| Inicio | Pantalla de bienvenida con animación del logo y carrusel de 3 pasos (Descarga, Escucha, Organiza), ambos desactivables |

## Pantallas

### Música

| Función | Detalle |
|---|---|
| Vistas | Mis descargas, Todas (carpeta Música del teléfono), Me Gustan, Listas |
| Búsqueda | Por título, artista o álbum |
| Orden | Recientes, Título A-Z, Artista A-Z |
| Escaneo de la carpeta Música | Resultado guardado en disco; al reabrir se muestra al instante y se refresca en segundo plano |
| Canciones externas | Metadatos leídos del ID3 del archivo; sin edición |
| Selección múltiple | Mantener pulsado; eliminar o agregar a una lista |
| Compartir | Desde la biblioteca o Editar canción, siempre como `.mp3` |
| Listas | Crear, renombrar, reproducir, agregar desde cualquier pantalla (hoja "Agregar a una lista") |

### Spotify

| Función | Detalle |
|---|---|
| Origen | Likes enviados por la extensión de Spicetify al servidor |
| Caché | Lista disponible sin conexión, con fecha de última sincronización |
| Búsqueda y orden | Canción, artista o álbum; búsqueda sin tildes y multi-término |
| Reproducción | Streaming desde el servidor (`/api/stream`) o, sin servidor, con una WebView oculta de YouTube |
| Descarga | Descargar seleccionadas o descargar todas a la biblioteca; se marcan las ya descargadas |
| Bajas | Quitar un like desde la app lo elimina en Spotify en la siguiente sincronización (configurable en la extensión) |
| Pulsación larga | Selección múltiple, o abrir en la app de Spotify (ajuste) |

### Descargar

| Función | Detalle |
|---|---|
| Por enlace | MP3 directo o enlace de YouTube; progreso por etapas desde el servidor |
| YouTube integrado | Navegador `m.youtube.com` con bloqueo básico de anuncios, reproducción en segundo plano y botón "Descargar este video" |
| Descargas | Lista de descargas de la sesión con progreso |
| Resultado | MP3 con ID3 (título, artista, álbum, portada) |

### Reproduciendo

| Función | Detalle |
|---|---|
| Controles | Anterior, pausa, siguiente, aleatorio, repetir, barra de progreso |
| Cola | Lista desde la que se inició la reproducción (biblioteca, lista o Spotify) |
| Letra | LRCLIB; sincronizada cuando existe, con resaltado de la línea actual; letra plana como alternativa |
| Fondo | Tono pastel derivado de la portada, con intensidad suave, media o fuerte |
| Acciones | Agregar a una lista, editar canción, eliminar |
| Sistema | Notificación multimedia y controles en pantalla de bloqueo |

### Editar canción

| Función | Detalle |
|---|---|
| Campos | Título, Artista, Álbum (opcional) |
| Portada | Galería (recorte 1:1) o búsqueda en iTunes |
| Guardado | Escribe ID3 en el archivo |

### Ajustes

| Sección | Opciones |
|---|---|
| Conversión de YouTube | URL del servidor, clave de acceso, probar conexión |
| Privacidad | Ocultar mis descargas a otras apps (activo por defecto) |
| Temas | Fondo según la portada, intensidad del color |
| Pantalla | Ocultar barras del sistema |
| Batería | Ahorro de energía (activo por defecto), modo sin conexión |
| Spotify | Mantener pulsado abre Spotify, streaming desde el servidor |
| Bienvenida | Pantalla de bienvenida, carrusel de introducción, ver introducción ahora |
| Almacenamiento | Borrar todas las descargas |

## Widgets de Android

| Tamaño | Variantes |
|---|---|
| Fila 4×1 | Opaco, semitraslúcido, transparente |
| Medio 4×2 | Opaco, semitraslúcido, transparente |
| Portada 4×2 | Carátula a pantalla completa |
| Portada 4×4 | Carátula grande, redimensionable |
| Cuadrado 2×2 | Carátula con controles |

## Comportamiento en segundo plano

| Punto | Detalle |
|---|---|
| Privacidad | Descargas en almacenamiento privado con extensión `.zc3`; no aparecen en la galería ni en otros reproductores |
| Compartir | Se entrega una copia temporal `Título.mp3` |
| Respaldo | Listas y Me Gustan se copian al servidor 3 s después de cada cambio; una instalación nueva restaura el respaldo |
| Descargas largas | Audio silencioso con notificación "Descargando…" mantiene la app activa con la pantalla apagada |
| Ahorro de energía | Progreso cada 2 s y animaciones detenidas; sin actualizaciones de interfaz con la pantalla apagada |
| Modo sin conexión | Sin ping, sincronización, descargas, letras nuevas, portadas ni YouTube; solo audio local |
