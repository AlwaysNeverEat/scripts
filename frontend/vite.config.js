import { defineConfig, loadEnv } from 'vite';
import { transform } from 'esbuild';

// Комментарии HTML не должны утекать в прод: в index.html их много, они
// объясняют устройство сайта (включая выключенные вкладки), и читать их должен
// разработчик в репозитории, а не любой человек через «посмотреть код
// страницы». Вырезаем ТОЛЬКО при сборке — в dev и в исходниках всё остаётся.
// Инлайновый скрипт темы/акцента минифицируется esbuild-ом по той же причине:
// vite сам инлайновые НЕмодульные скрипты не трогает, и его комментарии
// уезжали бы в прод дословно.
const stripProdComments = () => ({
  name: 'strip-prod-comments',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    async handler(html) {
      html = html.replace(/<!--[\s\S]*?-->/g, '');
      for (const m of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]) {
        const min = await transform(m[1], { minify: true });
        html = html.replace(m[0], `<script>${min.code}</script>`);
      }
      // Схлопываем оставшиеся от комментариев пустые строки, чтобы файл не
      // выглядел дырявым.
      return html.replace(/\n[ \t]*(?=\n)/g, '');
    },
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_BASE || 'http://127.0.0.1:3001';

  return {
    root: '.',
    // относительные пути ассетов — сайт работает и с корня, и с подпапки
    // (GitHub Pages отдаёт его с https://<user>.github.io/<repo>/)
    base: './',
    plugins: [stripProdComments()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: 'index.html',
          // Записи живут внутри основного приложения (роут #/records);
          // records.html остался редиректом для старых ссылок.
          records: 'records.html',
        },
      },
    },
    server: {
      port: 5173,
      host: true, // слушать на 0.0.0.0
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        // boot-экран пингует /health, чтобы понять что сервер проснулся
        '/health': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    define: {
      __API_BASE__: JSON.stringify(env.VITE_API_BASE || ''),
      __API_KEY__: JSON.stringify(env.VITE_API_KEY || ''),
    },
  };
});