import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cible de l'API : VITE_PROXY (défaut http://localhost:4000 — conteneur API en dev local)
const API_TARGET = process.env.VITE_PROXY || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // Résilience : si l'API est injoignable, renvoyer un JSON explicite (503)
        // au lieu de laisser le proxy produire une erreur opaque / un 502 gateway.
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error('[proxy /api] API injoignable :', err.message);
            try {
              if (res && !res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'Service backend momentanément injoignable. Vérifiez que l\'API AMI PHARMA est démarrée (port 4000).',
                }));
              }
            } catch { /* réponse déjà fermée */ }
          });
        },
      },
    },
  },
  preview: { host: '0.0.0.0', port: 5173 },
});
