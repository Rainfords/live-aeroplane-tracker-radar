export default async (request, context) => {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '/v2/aircraft';
  const apiUrl = `https://api.adsb.lol${path}`;

  try {
    const res  = await fetch(apiUrl);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=15',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};

export const config = { path: '/api/aircraft' };
