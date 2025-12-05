import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { z } from 'zod';
import { fetchCloudflare, fetchAllCloudflare } from './utils.js';

// Configuración inicial
const app = express();
const FileStore = FileStoreFactory(session);
const PORT = Number(process.env.VUZON_PORT || process.env.PORT) || 8001;

// Variables de Entorno (Punto B)
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;
const ZONE_ID = process.env.CF_ZONE_ID;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const DOMAIN = process.env.DOMAIN;

// --- C. Gestión del Secreto (Seguridad) ---
const SECRET_FILE = '.session_secret';
let sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  if (fs.existsSync(SECRET_FILE)) {
    sessionSecret = fs.readFileSync(SECRET_FILE, 'utf-8');
  } else {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, sessionSecret);
    console.log('Generado nuevo secreto de sesión en .session_secret');
  }
}

// Middlewares base
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- A. Dependencias y Configuración de Sesión ---
app.use(session({
  store: new FileStore({
    path: './sessions',
    ttl: 86400, // 1 día en segundos
    retries: 0
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 días
    httpOnly: true,
    sameSite: 'lax', // Ajustar a 'strict' si usas HTTPS
    secure: process.env.NODE_ENV === 'production' // Solo true si tienes HTTPS
  }
}));

// --- E. Middleware de Protección ---
const requireAuth = (req, res, next) => {
  // 1. Verificar si hay usuario/pass configurado
  if (!AUTH_USER || !AUTH_PASS) {
    return res.status(500).json({ error: 'Credenciales de servidor no configuradas (AUTH_USER/AUTH_PASS)' });
  }

  // 2. Verificar sesión
  if (req.session && req.session.authenticated) {
    return next();
  }

  // 3. Manejo de redirección vs JSON
  if (req.accepts('html')) {
    return res.redirect('/login.html');
  } else {
    return res.status(401).json({ error: 'No autorizado' });
  }
};

// --- D. Flujo de Login ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  // Validación simple contra env vars
  if (username === AUTH_USER && password === AUTH_PASS) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'Credenciales incorrectas' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Error al cerrar sesión' });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// Servir archivos estáticos PÚBLICOS (login.html, css, imágenes)
// Nota: Excluimos index.html de aquí para protegerlo con requireAuth si se desea, 
// o protegemos solo la API. En este caso, servimos todo público excepto la API.
app.use(express.static('public'));

// --- API Endpoints (Protegidos) ---

// Schemas Zod (Mismos que antes)
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

app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    email: AUTH_USER || 'admin',
    rootDomain: DOMAIN,
  });
});

app.get('/api/addresses', requireAuth, async (req, res) => {
  try {
    const result = await fetchAllCloudflare(`/accounts/${ACCOUNT_ID}/email/routing/addresses`);
    const mapped = result.map(r => ({
      email: r.email,
      id: r.id,
      verified: r.verified
    }));
    res.json({ result: mapped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/addresses', requireAuth, async (req, res) => {
  try {
    const body = addressSchema.parse(req.body);
    const apiRes = await fetchCloudflare(`/accounts/${ACCOUNT_ID}/email/routing/addresses`, 'POST', {
      email: body.email
    });
    res.json({ ok: true, result: apiRes });
  } catch (err) {
    res.status(err instanceof z.ZodError ? 400 : 500).json({ error: err.message });
  }
});

app.delete('/api/addresses/:id', requireAuth, async (req, res) => {
  try {
    await fetchCloudflare(`/accounts/${ACCOUNT_ID}/email/routing/addresses/${req.params.id}`, 'DELETE');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rules', requireAuth, async (req, res) => {
  try {
    const rules = await fetchAllCloudflare(`/zones/${ZONE_ID}/email/routing/rules`);
    res.json({ result: rules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rules', requireAuth, async (req, res) => {
  try {
    const { localPart, destEmail } = ruleSchema.parse(req.body);
    const aliasEmail = `${localPart}@${DOMAIN}`;
    
    const payload = {
      name: aliasEmail,
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: aliasEmail }],
      actions: [{ type: 'forward', value: [destEmail] }]
    };
    
    const apiRes = await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules`, 'POST', payload);
    res.json({ ok: true, result: apiRes });
  } catch (err) {
    res.status(err instanceof z.ZodError ? 400 : 500).json({ error: err.message });
  }
});

app.post('/api/rules/:id/:action', requireAuth, async (req, res) => {
  const { id, action } = req.params;
  const enabled = action === 'enable';

  try {
    const rule = await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules/${id}`);
    const apiRes = await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules/${id}`, 'PUT', {
      ...rule,
      enabled
    });
    res.json({ result: apiRes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rules/:id', requireAuth, async (req, res) => {
  try {
    await fetchCloudflare(`/zones/${ZONE_ID}/email/routing/rules/${req.params.id}`, 'DELETE');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback para SPA (Single Page Application)
// Si acceden a /, requireAuth verificará sesión. Si no hay, redirect a login.html
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.resolve('public/index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (Express + Session File Store)`);
  console.log(`Auth User: ${AUTH_USER}`);
});
