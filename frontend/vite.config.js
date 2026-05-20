import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_BASE || 'http://127.0.0.1:3001';

  return {
    root: '.',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      host: true, // слушать на 0.0.0.0
      proxy: {
        '/api': {
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