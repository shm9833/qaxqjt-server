// Debug function: test fetch to backend
export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  const backendUrl = 'http://1.14.106.173:3001/v1/healthz';
  
  const debug = {
    requestUrl: context.request.url,
    pathname: url.pathname,
    backendUrl: backendUrl,
    fetchResult: null,
    error: null
  };
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const resp = await fetch(backendUrl, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    debug.fetchResult = {
      status: resp.status,
      statusText: resp.statusText,
      contentType: resp.headers.get('content-type')
    };
    
    const body = await resp.text();
    debug.fetchResult.body = body.substring(0, 500);
  } catch (err) {
    debug.error = {
      name: err.name,
      message: err.message,
      toString: String(err)
    };
  }
  
  return new Response(JSON.stringify(debug, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-edge-proxy': 'fetch-debug'
    }
  });
};
