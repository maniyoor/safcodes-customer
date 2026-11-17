export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function relay(request, { params }) {
  const { route } = await params;
  if (!route.every(part => /^[a-z0-9_-]+$/i.test(part))) {
    return Response.json({ error: 'Invalid API path.' }, { status: 400 });
  }
  const headers = new Headers();
  for (const name of ['origin', 'sec-fetch-site', 'content-type', 'x-safcodes-api', 'idempotency-key']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const sessionCookie = request.headers.get('cookie')?.split(';').map(item => item.trim())
    .find(item => /^safcodes_customer_session=[a-f0-9]{64}$/.test(item));
  if (sessionCookie) headers.set('cookie', sessionCookie);
  try {
    const origin = new URL(process.env.SAFCODES_API_ORIGIN || 'http://127.0.0.1:5173');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('Invalid API origin');
    }
    const result = await fetch(new URL('/api/client/v1/' + route.join('/'), origin), {
      method: request.method, headers, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(35000),
      ...(request.method === 'POST' ? { body: request.body, duplex: 'half' } : {}),
    });
    const responseHeaders = new Headers({
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const session = result.headers.get('set-cookie');
    if (session) responseHeaders.set('Set-Cookie', session);
    return new Response(result.body, { status: result.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: 'The Safcodes API is unavailable. Check that the Node API is running.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const GET = relay;
export const POST = relay;
