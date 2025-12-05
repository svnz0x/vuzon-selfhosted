import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { basicAuth } from 'hono/basic-auth';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { fetchCloudflare, fetchAllCloudflare } from './utils.js';

const app = new Hono();

// Configuración
const PORT = Number(process.env.PORT) || 8001;
const ZONE_ID = process.env.CF_ZONE_ID;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const DOMAIN = process.env.DOMAIN;
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;

// --- Middlewares ---

// 1. Seguridad HTTP
app.use('*', secureHeaders());

// 2. Autenticación Básica
if (AUTH_USER && AUTH_PASS) {
  app.use('/*', basicAuth({
    username: AUTH_USER,
    password: AUTH_PASS,
    realm: 'Vuzon Admin Area'
  }));
}

// --- Validaciones (Zod) ---
const addressSchema = z.object({
  email: z.string().email("Formato de correo inválido")
});

const ruleSchema = z.object({
  localPart: z.string()
    .min(1, "El alias no puede estar vacío")
    .max(64, "El alias es demasiado largo")
    .regex(/^[a-z0-9._-]+$/, "Solo minúsculas, números, puntos y guiones"),
  destEmail: z.string().email("Email de destino inválido")
});

// --- API Endpoints ---

app.get('/api/me', (c) => {
  return c.json({
    email: AUTH_USER || 'admin',
    rootDomain: DOMAIN,
  });
});

// Usamos fetchAllCloudflare para paginación
app.get('/api/addresses', async (c) => {
  try {
    const result = await fetchAllCloudflare(`/accounts/${ACCOUNT_ID}/email/routing/addresses`);
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

app.post('/api/addresses', zValidator('json', addressSchema), async (c) => {
  const body = c.req.valid('json');
  try {
    const res = await fetchCloudflare(`/accounts/${ACCOUNT_ID}/email/routing/addresses`, 'POST', {
      email: body.email
    });
    return c.json({ ok: true, result: res });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.delete('/api/addresses/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await fetchCloudflare(`/accounts/${ACCOUNT_ID}/email/routing/addresses/${id}`, 'DELETE');
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Usamos fetchAllCloudflare para traer todas las reglas
app.get('/api/rules', async (c) => {
  try {
    const rules = await fetchAllCloudflare(`/zones/${ZONE_ID}/email/routing/rules`);
    return c.json({ result: rules });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/rules', zValidator('json', ruleSchema), async (c) => {
  const { localPart, destEmail } = c.req.valid('json');
  const aliasEmail = `${localPart}@${DOMAIN}`;
  
  try {
    const payload = {
      name: aliasEmail,
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: aliasEmail }],
      actions: [{ type: 'forward', value: [destEmail] }]
    };
    
    const res = await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules`, 'POST', payload);
    return c.json({ ok: true, result: res });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

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

app.delete('/api/rules/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules/${id}`, 'DELETE');
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.use('/*', serveStatic({ root: './public' }));

console.log(`Server running on port ${PORT}`);

serve({ fetch: app.fetch, port: PORT });
