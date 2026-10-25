// Родинна арена: сервер. Поки що каркас: /health і стартова сторінка.
import http from 'node:http';
import { readFile } from 'node:fs/promises';

export const VERSION = '0.0.1';

export function createServer() {
  return http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: VERSION }));
      return;
    }
    if (req.url === '/' || req.url === '/tv') {
      const html = await readFile(new URL('../public/index.html', import.meta.url));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404); res.end();
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8080);
  createServer().listen(port, () => console.log(`arena on :${port}`));
}
