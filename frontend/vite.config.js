import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_BASE || 'http://127.0.0.1:3001';

  return {
    root: '.',
    // относительные пути ассетов — сайт работает и с корня, и с подпапки
    // (GitHub Pages отдаёт его с https://<user>.github.io/<repo>/)
    base: './',
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