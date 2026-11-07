import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// Vite requires the config as the default export.
export default defineConfig({
  plugins: [react()],
  server: {proxy: {'/api': 'http://localhost:8000'}},
});
