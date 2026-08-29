// Simple test for /api/* catch-all route
export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  return new Response(JSON.stringify({
    ok: true,
    message: 'API catch-all function works!',
    pathname: url.pathname,
    search: url.search
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-edge-proxy': 'api-catchall-test'
    }
  });
};
