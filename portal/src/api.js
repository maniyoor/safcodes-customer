const root = '/api/client/v1';

export async function api(path, body, key) {
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Safcodes-API': '1' };
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(root + path, {
    method: body === undefined ? 'GET' : 'POST', headers, credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.error || 'The portal could not complete the request.'), { status: response.status });
  return value;
}

export const accountPath = (id, resource) => '/accounts/' + id + '/' + resource;
