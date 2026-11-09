// Levanta el servidor MusicDown y un túnel rápido de Cloudflare con un solo comando:
//   npm run start:tunnel
// Muestra la URL https pública (cambia en cada arranque) para pegarla en la app: Ajustes -> Servidor.
// Al salir (Ctrl+C) cierra ambos procesos.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3008;
const SERVER_FILE = path.join(__dirname, '..', 'server.js');
const WINDOWS_DEFAULT = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // ya había terminado
    }
  }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function cloudflaredPath() {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
  if (process.platform === 'win32' && fs.existsSync(WINDOWS_DEFAULT)) return WINDOWS_DEFAULT;
  return 'cloudflared';
}

function banner(url) {
  const hasKey = Boolean(process.env.ACCESS_KEY || process.env.API_KEY);
  const lines = [
    '',
    '  ┌─ MusicDown · servidor en línea ─────────────────────────────',
    `  │  URL pública:  ${url}`,
    '  │',
    '  │  En la app: Ajustes → Servidor → pega esa URL y pulsa Guardar.',
    hasKey
      ? '  │  Clave de acceso: la de ACCESS_KEY en server/.env (Ajustes → Clave de acceso).'
      : '  │  ⚠ ACCESS_KEY no está definida: cualquiera con la URL podría usar tu servidor.',
    '  │  La URL cambia cada vez que reinicias este comando.',
    '  └──────────────────────────────────────────────────────────────',
    '',
  ];
  console.log(lines.join('\n'));
}

// 1) Servidor
const server = spawn(process.execPath, [SERVER_FILE], { stdio: 'inherit', env: process.env });
children.push(server);
server.on('exit', (code) => {
  if (shuttingDown) return;
  console.error(`[start:tunnel] El servidor terminó (código ${code}). Cerrando el túnel.`);
  shutdown(code || 1);
});

// 2) Túnel
const tunnel = spawn(cloudflaredPath(), ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(tunnel);

let announced = false;
function onTunnelOutput(chunk) {
  const text = chunk.toString();
  if (!announced) {
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      announced = true;
      banner(match[0]);
    }
  } else if (/error|failed|ERR/i.test(text) && !/Retrying|retrying/.test(text)) {
    process.stderr.write(`[cloudflared] ${text}`);
  }
}
tunnel.stdout.on('data', onTunnelOutput);
tunnel.stderr.on('data', onTunnelOutput);

tunnel.on('error', (e) => {
  console.error(
    `[start:tunnel] No se pudo iniciar cloudflared (${e.message}).\n` +
      '  Instálalo con:  winget install Cloudflare.cloudflared\n' +
      '  o define CLOUDFLARED_PATH en server/.env con la ruta del ejecutable.'
  );
  shutdown(1);
});
tunnel.on('exit', (code) => {
  if (shuttingDown) return;
  console.error(`[start:tunnel] cloudflared terminó (código ${code}). Cerrando el servidor.`);
  shutdown(code || 1);
});
