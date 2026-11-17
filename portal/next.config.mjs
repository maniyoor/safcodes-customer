import { fileURLToPath } from 'node:url';

export default {
  devIndicators: false,
  agentRules: false,
  outputFileTracingRoot: fileURLToPath(new URL('.',import.meta.url)),
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
    ] }];
  },
};
