import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/192.png', 'icons/512.png', 'icons/512-maskable.png'],
      manifest: {
        name: "Mrs. Li's Intonation Trainer 李老师的音准练习",
        short_name: '音准练习',
        description:
          "Mrs. Li's piano with sustained drones for singing in tune. 李老师的音准练习：持续长音钢琴。",
        display: 'standalone',
        orientation: 'any',
        theme_color: '#C0587C',
        background_color: '#FDF8E9',
        icons: [
          { src: 'icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,mp3,webmanifest}'],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
