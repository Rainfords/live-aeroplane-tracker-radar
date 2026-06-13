exports.handler = async (event) => {
  const qs = new URLSearchParams(event.queryStringParameters || {});
  const url = `https://opensky-network.org/api/states/all${qs.toString() ? '?' + qs : ''}`;

  try {
    const res  = await fetch(url);
    const body = await res.text();
    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body,
    };
  } catch (err) {
    console.error('opensky proxy error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message, cause: String(err.cause ?? ''), stack: err.stack }),
    };
  }
};
