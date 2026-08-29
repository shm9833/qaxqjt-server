// Debug: check method and body passthrough
export const onRequest = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  
  const method = request.method.toUpperCase();
  const hasBody = !(method === 'GET' || method === 'HEAD');
  
  let bodyInfo = 'no-body';
  let bodyContent = '';
  if (hasBody) {
    const buf = await request.arrayBuffer();
    bodyContent = new TextDecoder().decode(buf);
    bodyInfo = `arrayBuffer length=${buf.byteLength}, content="${bodyContent.substring(0, 100)}"`;
  }
  
  // Forward to backend and return debug info
  const backendUrl = 'http://1.14.106.173:3001/v1/auth/login';
  const reqHeaders = new Headers();
  reqHeaders.set('content-type', 'application/json');
  
  try {
    const resp = await fetch(backendUrl, {
      method: method,
      headers: reqHeaders,
      body: hasBody ? bodyContent : undefined
    });
    
    const respBody = await resp.text();
    return new Response(JSON.stringify({
      requestMethod: method,
      bodyInfo: bodyInfo,
      backendStatus: resp.status,
      backendBody: respBody.substring(0, 300)
    }, null, 2), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-edge-proxy': 'debug-post' }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      requestMethod: method,
      bodyInfo: bodyInfo,
      error: String(err)
    }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
