// Simple test function to verify EdgeOne Pages Functions work
export const onRequest = async (context) => {
  return new Response(JSON.stringify({
    ok: true,
    message: 'EdgeOne Pages Function is working!',
    url: context.request.url,
    method: context.request.method
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-edge-proxy': 'test-function'
    }
  });
};
