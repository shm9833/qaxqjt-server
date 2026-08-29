// Progressive test: path stripping + headers, no body handling
const DEFAULT_BACKEND_URL = 'http://1.14.106.173:3001';

export const onRequest = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  let backendPath = pathname;
  if (backendPath.startsWith('/api/')) {
    backendPath = backendPath.slice(4);
  } else if (backendPath.startsWith('/api')) {
    backendPath = backendPath.slice(4) || '/';
  }

  const backendUrl = DEFAULT_BACKEND_URL + backendPath + search;

  const reqHeaders = new Headers();
  const auth = request.headers.get('authorization');
  if (auth) reqHeaders.set('authorization', auth);
  const ct = request.headers.get('content-type');
  if (ct) reqHeaders.set('content-type', ct);

  try {
    const resp = await fetch(backendUrl, {
      method: request.method,
      headers: reqHeaders,
      redirect: 'manual'
    });

    const respHeaders = new Headers();
    const rct = resp.headers.get('content-type');
    if (rct) respHeaders.set('content-type', rct);
    respHeaders.set('x-edge-proxy', 'progressive-test');
    respHeaders.set('access-control-allow-origin', '*');

    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(err)
    }), {
      status: 502,
      headers: { 'content-type': 'application/json' }
    });
  }
};
