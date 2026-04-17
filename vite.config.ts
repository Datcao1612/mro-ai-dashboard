import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      output: {
        // Split @google/genai into its own chunk so it's loaded separately
        // from the main app code. pdfjs-dist and xlsx are already split
        // automatically via dynamic import() in fileParser.ts / exportToExcel().
        manualChunks: {
          'vendor-react':  ['react', 'react-dom'],
          'vendor-gemini': ['@google/genai'],
        },
      },
    },
  },
})
