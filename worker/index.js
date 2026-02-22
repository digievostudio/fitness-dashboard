/**
 * Fitbit CORS Proxy — Cloudflare Worker
 * Forwards requests to api.fitbit.com and adds CORS headers.
 * Only allows requests from the dashboard origin.
 */

const FITBIT_API = 'https://api.fitbit.com';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || 'https://digievostudio.github.io';

    // Only allow our dashboard origin
    if (origin && !origin.startsWith(allowed)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowed) });
    }

    // Extract the Fitbit API path from the request URL
    const url = new URL(request.url);
    const fitbitPath = url.pathname + url.search;
    const fitbitUrl = FITBIT_API + fitbitPath;

    // Forward the request to Fitbit
    const headers = new Headers();
    const auth = request.headers.get('Authorization');
    if (auth) headers.set('Authorization', auth);
    headers.set('Accept', 'application/json');

    try {
      const resp = await fetch(fitbitUrl, {
        method: request.method,
        headers,
        body: request.method === 'POST' ? await request.text() : undefined,
      });

      // Clone response and add CORS headers
      const body = await resp.arrayBuffer();
      const responseHeaders = new Headers(resp.headers);
      Object.entries(corsHeaders(allowed)).forEach(([k, v]) => responseHeaders.set(k, v));

      return new Response(body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: responseHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { ...corsHeaders(allowed), 'Content-Type': 'application/json' },
      });
    }
  },
};
