import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { id: '/', name: 'GIORNALE AI24 — by KEG Studios', short_name: 'AI24', description: 'Notizie italiane, fonti trasparenti e articoli salvati per la lettura offline.', lang: 'it-IT', dir: 'ltr', start_url: '/', scope: '/', display: 'standalone', background_color: '#061727', theme_color: '#061727', categories: ['news'], icons: [
    { src: '/brand/ai24-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/brand/ai24-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/brand/ai24-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/brand/ai24-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ], shortcuts: [{ name: 'Ultim’ora', short_name: 'Ultim’ora', url: '/ultim-ora' }, { name: 'Articoli offline', short_name: 'Offline', url: '/offline' }] };
}
