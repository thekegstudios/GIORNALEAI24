import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['pg'],
  outputFileTracingIncludes: { '/*': ['migrations/*.sql'] },
  outputFileTracingExcludes: { '/*': ['data/**/*', '.data/**/*', 'artifacts/**/*', '.env*'] },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' }
    ] },{source:'/sw.js',headers:[{key:'Content-Type',value:'application/javascript; charset=utf-8'},{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self'"}]}];
  }
};
export default config;
