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

// Variables de Entorno Básicas
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;
const DOMAIN = process.env.DOMAIN;

// --- MEJORA: Detección más flexible de HTTPS/Producción ---
// isHttps: solo verdadero si la URL explícitamente empieza por https
const isHttps = process.env.BASE_URL?.startsWith('https');
// isProduction: solo verdadero si el entorno está marcado como producción
const isProduction = process.env.NODE_ENV === 'production';

// Confiar en el proxy si estamos en https o en producción (necesario para cookies tras proxy/docker)
if (isHttps || isProduction) {
  app.set('trust proxy', 1);
}

// --- Gestión del Secreto (Seguridad) ---
const SECRET_FILE = '.session_secret';
let sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  if (fs.existsSync(SECRET_FILE)) {
    sessionSecret = fs.readFileSync(SECRET_FILE, 'utf-8');
  } else {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(SECRET_FILE, sessionSecret);
      console.log('Generado nuevo secreto de sesión en .session_secret');
    } catch (err) {
      console.warn('⚠️ No se pudo guardar .session_secret (revisa permisos), pero se usará en memoria.');
    }
  }
}

// Middlewares base
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Configuración de Sesión ---
app.use(session({
  store: new FileStore({
    path: './sessions',
    ttl: 86400, // 1 día
    retries: 0
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 días
    httpOnly: true,
    sameSite: 'lax', 
    // CORRECCIÓN PRINCIPAL:
    // Solo requerir cookie 'Secure' si la URL es https O si estamos forzando producción.
    // Esto permite que funcione en http://IP_LOCAL sin problemas.
    secure: isHttps || isProduction 
  }
}));

// --- Middleware de Protección ---
const requireAuth = (req, res, next) => {
  if (!AUTH_USER || !AUTH_PASS) {
    return res.status(500).json({ error: 'Credenciales de servidor no configuradas (AUTH_USER/AUTH_PASS)' });
  }

  if (req.session && req.session.authenticated) {
    return next();
  }

  if (req.accepts('html')) {
    return res.redirect('/login.html');
  } else {
    return res.status(401).json({ error: 'No autorizado' });
  }
};

// --- Flujo de Login ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
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

// { index: false } evita que sirva index.html automáticamente en la raíz '/'.
// Así obligamos a que la petición '/' caiga en el manejador de abajo con requireAuth.
app.use(express.static('public', { index: false }));

// --- API Endpoints (Protegidos) ---
// Nota: Usamos process.env.CF_XXX directamente para soportar la autoconfiguración

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
    const result = await fetchAllCloudflare(`/accounts/${process.env.CF_ACCOUNT_ID}/email/routing/addresses`);
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
    const apiRes = await fetchCloudflare(`/accounts/${process.env.CF_ACCOUNT_ID}/email/routing/addresses`, 'POST', {
      email: body.email
    });
    res.json({ ok: true, result: apiRes });
  } catch (err) {
    res.status(err instanceof z.ZodError ? 400 : 500).json({ error: err.message });
  }
});

app.delete('/api/addresses/:id', requireAuth, async (req, res) => {
  try {
    await fetchCloudflare(`/accounts/${process.env.CF_ACCOUNT_ID}/email/routing/addresses/${req.params.id}`, 'DELETE');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rules', requireAuth, async (req, res) => {
  try {
    const rules = await fetchAllCloudflare(`/zones/${process.env.CF_ZONE_ID}/email/routing/rules`);
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
    
    const apiRes = await fetchCloudflare(`/zones/${process.env.CF_ZONE_ID}/email/routing/rules`, 'POST', payload);
    res.json({ ok: true, result: apiRes });
  } catch (err) {
    res.status(err instanceof z.ZodError ? 400 : 500).json({ error: err.message });
  }
});

app.post('/api/rules/:id/:action', requireAuth, async (req, res) => {
  const { id, action } = req.params;
  const enabled = action === 'enable';

  try {
    const rule = await fetchCloudflare(`/zones/${process.env.CF_ZONE_ID}/email/routing/rules/${id}`);
    const apiRes = await fetchCloudflare(`/zones/${process.env.CF_ZONE_ID}/email/routing/rules/${id}`, 'PUT', {
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
    await fetchCloudflare(`/zones/${process.env.CF_ZONE_ID}/email/routing/rules/${req.params.id}`, 'DELETE');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback para SPA (Ahora sí se ejecuta gracias a index: false arriba)
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.resolve('public/index.html'));
});

// --- MEJORA: Autoconfiguración ---
async function autoConfigure() {
  // Si ya tenemos los IDs, no hacemos nada
  if (process.env.CF_ZONE_ID && process.env.CF_ACCOUNT_ID) return;

  console.log('⚙️ Faltan IDs de configuración. Detectando automáticamente...');
  
  if (!process.env.DOMAIN || !process.env.CF_API_TOKEN) {
    throw new Error('Imposible autoconfigurar: Faltan DOMAIN o CF_API_TOKEN');
  }

  try {
    // Buscamos la zona por nombre
    const zones = await fetchCloudflare(`/zones?name=${process.env.DOMAIN}`);
    const zone = zones[0];
    
    if (!zone) {
      throw new Error(`Dominio ${process.env.DOMAIN} no encontrado en esta cuenta de Cloudflare.`);
    }
    
    // Inyectamos las variables en tiempo de ejecución
    process.env.CF_ZONE_ID = zone.id;
    process.env.CF_ACCOUNT_ID = zone.account.id;
    
    console.log(`✅ Autoconfiguración exitosa para ${process.env.DOMAIN}`);
    console.log(`   Zone ID: ${zone.id}`);
    console.log(`   Account ID: ${zone.account.id}`);
  } catch (err) {
    console.error('❌ Error fatal en autoconfiguración:', err.message);
    process.exit(1);
  }
}

// Iniciar servidor después de asegurar la configuración
autoConfigure().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔒 Modo Seguro (HTTPS): ${isHttps ? 'SI' : 'NO'} | Producción: ${isProduction ? 'SI' : 'NO'}`);
    console.log(`👤 Auth User: ${AUTH_USER}`);
  });
});
