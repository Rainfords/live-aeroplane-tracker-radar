export default async (request, context) => {
  const url = new URL(request.url);
  const qs = url.searchParams.get('qs') || '';
  const apiUrl = `https://opensky-network.org/api/states/all${qs ? '?' + qs : ''}`;

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
