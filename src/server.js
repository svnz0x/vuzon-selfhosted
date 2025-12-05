import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { basicAuth } from 'hono/basic-auth'; //
import { fetchCloudflare } from './utils.js';

const app = new Hono();

// Configuración de Puerto (8001 por defecto) y dominio
const PORT = Number(process.env.PORT) || 8001;
const ZONE_ID = process.env.CF_ZONE_ID;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
// Cambio: ROOT_DOMAIN ahora es DOMAIN según tu nuevo .env
const DOMAIN = process.env.DOMAIN; 

// Credenciales de acceso
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;

// --- Middlewares ---

// 1. Autenticación Básica (Protege todo el sitio si las variables existen)
if (AUTH_USER && AUTH_PASS) {
  app.use('/*', basicAuth({
    username: AUTH_USER,
    password: AUTH_PASS,
    realm: 'Vuzon Admin Area'
  }));
}

// -- API Endpoints --

// Perfil simple
app.get('/api/me', (c) => {
  return c.json({
    email: AUTH_USER || 'admin', // Muestra el usuario configurado
    subdomain: '@', 
    rootDomain: DOMAIN,
    fqdn: DOMAIN,
    hasRoutingMx: true 
  });
});

// Listar destinos (Emails verificados)
app.get('/api/addresses', async (c) => {
  try {
    const result = await fetchCloudflare(`/accounts/${ACCOUNT_ID}/email/routing/addresses?per_page=50`);
    const mapped = result.map(r => ({
      email: r.email,
      id: r.id,
      verified: r.verified
    }));
    return c.json({ result: mapped });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Crear destino
app.post('/api/addresses', async (c) => {
  const body = await c.req.json();
  try {
    const res = await fetchCloudflare(`/accounts/${ACCOUNT_ID}/email/routing/addresses`, 'POST', {
      email: body.email
    });
    return c.json({ ok: true, result: res });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Borrar destino
app.delete('/api/addresses/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await fetchCloudflare(`/accounts/${ACCOUNT_ID}/email/routing/addresses/${id}`, 'DELETE');
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Listar reglas (Alias)
app.get('/api/rules', async (c) => {
  try {
    const rules = await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules?per_page=100`);
    return c.json({ result: rules });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Crear regla (Alias)
app.post('/api/rules', async (c) => {
  const body = await c.req.json();
  const aliasEmail = `${body.localPart}@${DOMAIN}`;
  
  try {
    const payload = {
      name: aliasEmail,
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: aliasEmail }],
      actions: [{ type: 'forward', value: [body.destEmail] }]
    };
    
    const res = await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules`, 'POST', payload);
    return c.json({ ok: true, result: res });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Toggle Regla
app.post('/api/rules/:id/:action', async (c) => {
  const id = c.req.param('id');
  const action = c.req.param('action'); 
  const enabled = action === 'enable';

  try {
    const rule = await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules/${id}`);
    const res = await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules/${id}`, 'PUT', {
      ...rule,
      enabled
    });
    return c.json({ result: res });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Borrar regla
app.delete('/api/rules/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules/${id}`, 'DELETE');
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// -- Static Files --
app.use('/*', serveStatic({ root: './public' }));

console.log(`Server running on port ${PORT}`);

serve({
  fetch: app.fetch,
  port: PORT
});
