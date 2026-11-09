// Script para la WebView oculta del reproductor en segundo plano.
// - En la página de resultados de búsqueda: toma el primer video (sin anuncios ni Shorts) y lo abre.
// - En la página del video: lo mantiene en el estado pedido por la app (play/pausa), avisa cuando
//   termina y reporta el progreso a React Native con postMessage.
// La app lo controla con window.__mdSetDesired('play' | 'pause') y window.__mdSeek(segundos).
export const YOUTUBE_PLAYER_SCRIPT = `
(function () {
  if (window.__musicdownPlayer) return;
  window.__musicdownPlayer = true;

  var desired = 'play';
  var endedSent = false;
  var redirected = false;
  var startedAt = Date.now();

  function post(message) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (e) {}
  }

  function video() {
    return document.querySelector('video');
  }

  function tryPlay(v) {
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }

  window.__mdSetDesired = function (state) {
    desired = state;
    var v = video();
    if (!v) return;
    if (state === 'play') tryPlay(v);
    else v.pause();
  };

  window.__mdSeek = function (seconds) {
    var v = video();
    if (v) v.currentTime = seconds;
  };

  function isAdPlaying() {
    var player = document.querySelector('.html5-video-player');
    return !!(player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')));
  }

  var SKIP_CONTAINERS = [
    'ytm-promoted-video-renderer',
    'ytm-promoted-sparkles-web-renderer',
    'ad-slot-renderer',
    'ytm-ad-slot-renderer',
    'ytm-reel-shelf-renderer',
    'ytm-shorts-lockup-view-model',
  ].join(',');

  function firstResultId() {
    var links = document.querySelectorAll('a[href*="/watch?v="]');
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.closest(SKIP_CONTAINERS)) continue;
      var match = /[?&]v=([\\w-]{11})/.exec(link.getAttribute('href') || '');
      if (match) return match[1];
    }
    return null;
  }

  function tick() {
    var path = location.pathname;

    if (path.indexOf('/results') === 0) {
      if (redirected) return;
      var id = firstResultId();
      if (id) {
        redirected = true;
        post({ type: 'resolved', videoId: id });
        location.replace('https://m.youtube.com/watch?v=' + id);
      } else if (Date.now() - startedAt > 20000) {
        redirected = true;
        post({ type: 'error', message: 'YouTube no devolvió ningún video para esta canción.' });
      }
      return;
    }

    if (path.indexOf('/watch') === 0) {
      var v = video();
      if (!v) return;
      if (v.muted && !isAdPlaying()) v.muted = false;
      if (desired === 'play' && v.paused && !v.ended) tryPlay(v);
      if (v.ended && !isAdPlaying() && !endedSent) {
        endedSent = true;
        post({ type: 'ended' });
      }
      post({
        type: 'state',
        playing: !v.paused,
        ad: isAdPlaying(),
        currentTime: v.currentTime || 0,
        duration: isFinite(v.duration) ? v.duration : 0,
      });
    }
  }

  setInterval(tick, 1000);
})();
true;
`;
