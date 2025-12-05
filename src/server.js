import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { fetchCloudflare } from './utils.js';

const app = new Hono();
const PORT = Number(process.env.PORT) || 3000;

const ZONE_ID = process.env.CF_ZONE_ID;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const DOMAIN = process.env.ROOT_DOMAIN;

// -- API Endpoints --

// Perfil simple
app.get('/api/me', (c) => {
  return c.json({
    email: 'admin',
    subdomain: '@', // Representa la raíz
    rootDomain: DOMAIN,
    fqdn: DOMAIN,
    hasRoutingMx: true // Asumimos que lo tienes configurado
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
    // Traemos las reglas. Opcional: podrías filtrar las que terminen en tu DOMAIN si usas esa zona para otras cosas.
    const rules = await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules?per_page=100`);
    return c.json({ result: rules });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Crear regla (Alias)
app.post('/api/rules', async (c) => {
  const body = await c.req.json();
  // Construimos el email final: alias@midominio.com
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

// Toggle (Activar/Pausar) Regla
app.post('/api/rules/:id/:action', async (c) => {
  const id = c.req.param('id');
  const action = c.req.param('action'); // 'enable' o 'disable'
  const enabled = action === 'enable';

  try {
    // Primero necesitamos obtener la regla actual para no sobrescribir otros campos
    const rule = await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules/${id}`);
    
    // Actualizamos solo el estado 'enabled'
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
