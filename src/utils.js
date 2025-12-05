import 'dotenv/config';

const CF_API_URL = 'https://api.cloudflare.com/client/v4';

export const cfHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${process.env.CF_API_TOKEN}`
});

export async function fetchCloudflare(path, method = 'GET', body = null) {
  const url = `${CF_API_URL}${path}`;
  const options = {
    method,
    headers: cfHeaders(),
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json();
  
  // Cloudflare a veces devuelve 200 pero success: false
  if (!res.ok || !data.success) {
    const msg = data.errors?.[0]?.message || `Error ${res.status}`;
    throw new Error(msg);
  }
  return data.result;
}
