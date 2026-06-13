const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const API_BASE  = 'https://opensky-network.org/api/states/all';

async function getToken(clientId, clientSecret) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

exports.handler = async (event) => {
  const { clientId, clientSecret } = process.env;

  try {
    const qs  = new URLSearchParams(event.queryStringParameters || {});
    const url = `${API_BASE}${qs.toString() ? '?' + qs : ''}`;

    let headers = {};
    if (clientId && clientSecret) {
      const token = await getToken(clientId, clientSecret);
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res  = await fetch(url, { headers });
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
      body: JSON.stringify({ error: err.message, cause: String(err.cause ?? '') }),
    };
  }
};
