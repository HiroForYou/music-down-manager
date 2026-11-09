// Mantiene la reproducción de YouTube cuando se bloquea la pantalla o la app pasa a segundo plano.
// La WebView de Android no pausa el contenido por sí sola (RNCWebView.onHostPause no hace nada):
// es el JavaScript de YouTube el que pausa al detectar la página oculta vía Page Visibility API.
// Este script:
//   1. hace que document.hidden / visibilityState siempre digan "visible";
//   2. bloquea el evento visibilitychange (y el blur de la ventana) antes de que YouTube lo vea;
//   3. si aun así el video se pausa justo después de ocultarse la página, lo reanuda.
// Debe inyectarse antes de que cargue la página (injectedJavaScriptBeforeContentLoaded).
export const YOUTUBE_BACKGROUND_PLAY_SCRIPT = `
(function () {
  if (window.__musicdownBackgroundPlay) return;
  window.__musicdownBackgroundPlay = true;

  var hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  function isReallyHidden() {
    try {
      return hiddenDesc && hiddenDesc.get ? hiddenDesc.get.call(document) : false;
    } catch (e) {
      return false;
    }
  }

  function define(name, value) {
    try {
      Object.defineProperty(document, name, { configurable: true, get: function () { return value; } });
    } catch (e) {}
  }
  define('hidden', false);
  define('webkitHidden', false);
  define('visibilityState', 'visible');
  define('webkitVisibilityState', 'visible');
  try {
    document.hasFocus = function () { return true; };
  } catch (e) {}

  // Momento en que la página se ocultó de verdad (pantalla bloqueada / app en segundo plano).
  var hiddenAt = 0;

  // Listener en fase de captura sobre window: se ejecuta antes que cualquier listener de YouTube
  // en document, y corta la propagación.
  function swallowVisibility(e) {
    if (isReallyHidden()) hiddenAt = Date.now();
    e.stopImmediatePropagation();
  }
  window.addEventListener('visibilitychange', swallowVisibility, true);
  window.addEventListener('webkitvisibilitychange', swallowVisibility, true);

  // Solo el blur de la propia ventana; el de inputs y botones debe seguir funcionando.
  window.addEventListener('blur', function (e) {
    if (e.target === window) e.stopImmediatePropagation();
  }, true);

  // Red de seguridad: si el video se pausa en los primeros segundos tras ocultarse la página,
  // no fue el usuario (no puede tocar la pantalla bloqueada), así que se reanuda.
  // Pasado ese margen no se fuerza nada, para no pelear con una llamada entrante u otra app de audio.
  document.addEventListener('pause', function (e) {
    var media = e.target;
    if (!(media instanceof HTMLMediaElement) || media.ended) return;
    if (!isReallyHidden() || Date.now() - hiddenAt > 3000) return;
    setTimeout(function () {
      var p = media.play();
      if (p && p.catch) p.catch(function () {});
    }, 50);
  }, true);
})();
true;
`;
