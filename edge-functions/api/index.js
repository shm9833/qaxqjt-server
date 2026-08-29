// Test function for /api route
export const onRequest = async (context) => {
  return new Response(JSON.stringify({
    ok: true,
    message: 'API index function works!',
    url: context.request.url
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-edge-proxy': 'api-index'
    }
  });
};
