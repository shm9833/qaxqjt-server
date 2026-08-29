// Step-by-step debug: test with headers and redirect option
export const onRequest = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const backendUrl = 'http://1.14.106.173:3001/v1/healthz';
  
  const debug = { step: 'start', error: null };
  
  try {
    debug.step = 'creating headers';
    const reqHeaders = new Headers();
    reqHeaders.set('accept', 'application/json');
    reqHeaders.set('user-agent', 'edgeone-proxy');
    
    debug.step = 'fetching';
    const resp = await fetch(backendUrl, {
      method: 'GET',
      headers: reqHeaders,
      redirect: 'manual'
    });
    
    debug.step = 'reading response';
    debug.status = resp.status;
    debug.statusText = resp.statusText;
    
    const body = await resp.text();
    debug.body = body.substring(0, 300);
    
    debug.step = 'building response headers';
    const respHeaders = new Headers();
    respHeaders.set('content-type', 'application/json; charset=utf-8');
    respHeaders.set('x-edge-proxy', 'headers-test');
    respHeaders.set('access-control-allow-origin', '*');
    
    debug.step = 'returning response';
    return new Response(body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders
    });
  } catch (err) {
    debug.error = { name: err.name, message: err.message };
    return new Response(JSON.stringify(debug, null, 2), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
};
