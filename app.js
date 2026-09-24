// ============================================================
// app.js
// Construye la aplicación Express (middlewares, sesiones, rutas)
// y la EXPORTA sin ponerla a escuchar. Arrancar el servidor es
// trabajo de server.js; separarlo permite que las pruebas
// automáticas (supertest) usen la app completa sin abrir un puerto.
// ============================================================

// dotenv carga las variables de .env en process.env. Se llama
// antes que cualquier otro require que las use.
// quiet: sin el mensaje "injected env" que dotenv imprime en cada carga
// (en las pruebas salía una vez por archivo y ensuciaba el log del CI).
require('dotenv').config({ quiet: true });

const crypto  = require('crypto');
const path    = require('path');
const express = require('express');
const helmet  = require('helmet');
const session = require('express-session');

const db = require('./db/database');
const AlmacenSesionesPostgres = require('./db/almacen-sesiones');
const { requerirSesion, verificarOrigen } = require('./middleware/seguridad');

const auth          = require('./routes/auth');
const entregables   = require('./routes/entregables');
const horarios      = require('./routes/horarios');
const plan          = require('./routes/plan');
const configuracion = require('./routes/configuracion');

const app = express();

// ── Secreto de sesión ────────────────────────────────────────
// Firma la cookie de sesión. Viene de .env (SESSION_SECRET). Si no
// está definido se genera uno aleatorio en cada arranque: es seguro
// (nadie lo conoce ni está escrito en el código) pero las sesiones
// abiertas se invalidan al reiniciar. Nunca hay un secreto "por
// defecto" fijo en el código.
let secretoSesion = process.env.SESSION_SECRET;

// En PRODUCCIÓN no hay "plan B": sin un secreto propio y largo el
// servidor NO arranca (falla cerrado). Un secreto débil o ausente en
// un servidor público es justo lo que un atacante busca.
if (process.env.NODE_ENV === 'production' && (!secretoSesion || secretoSesion.length < 32)) {
  throw new Error('En producción SESSION_SECRET es obligatorio y debe tener al menos 32 caracteres.');
}

if (!secretoSesion) {
  secretoSesion = crypto.randomBytes(32).toString('hex');

  if (process.env.NODE_ENV !== 'test') {
    console.warn('⚠️  SESSION_SECRET no está definido en .env: se usa uno aleatorio y las sesiones se cerrarán al reiniciar el servidor.');
  }
}

// ── Detrás de un proxy (Railway) ─────────────────────────────
// En Railway el navegador habla HTTPS con el proxy de la plataforma y
// este con la app por HTTP normal. Sin "trust proxy", Express cree
// que la conexión NO es segura (y no manda la cookie Secure) y ve la
// IP del proxy en vez de la del visitante (el límite de intentos de
// login contaría a TODOS como una sola persona). TRUST_PROXY es el
// número de proxies de confianza delante de la app (1 en Railway).
// Apagado por defecto: confiar en X-Forwarded-For sin proxy real
// permitiría falsificar la IP.
const saltosProxy = Number(process.env.TRUST_PROXY);
if (Number.isInteger(saltosProxy) && saltosProxy > 0) {
  app.set('trust proxy', saltosProxy);
}

// ── Middlewares globales ─────────────────────────────────────

// Helmet agrega headers de seguridad HTTP (X-Content-Type-Options,
// X-Frame-Options, Content-Security-Policy, etc.). Va primero para
// que aplique a toda respuesta sin excepción.
//
// El CSP por defecto de Helmet ya es compatible con el frontend sin
// abrir excepciones: el CSS de Tailwind se sirve PRE-COMPILADO
// (npm run build:css), no hay scripts externos ni 'unsafe-eval', y
// todo el JS/CSS es propio ('self').
app.use(helmet());

// Frontend estático (public/index.html, css, js). Va antes de las
// sesiones para que servir archivos no toque la base de datos.
app.use(express.static(path.join(__dirname, 'public')));

// express.json() parsea el cuerpo JSON y lo deja en req.body.
app.use(express.json());

// Espera a que la base de datos esté lista (en pruebas, a que se aplique
// el esquema) antes de atender cualquier petición de la API.
app.use(async (req, res, next) => {
  try {
    await db.listo;
    next();
  } catch (error) {
    next(error);
  }
});

app.use(session({
  name: 'studyflow.sid',
  secret: secretoSesion,
  store: new AlmacenSesionesPostgres(),
  // No crear sesión (ni cookie) para visitantes que no han iniciado sesión.
  saveUninitialized: false,
  resave: false,
  // Cada petición renueva el vencimiento: la sesión dura 8 horas
  // de INACTIVIDAD, no 8 horas desde que se entró.
  rolling: true,
  cookie: {
    // JavaScript de la página no puede leer la cookie: si alguna vez
    // hubiera un XSS, no podría robarla.
    httpOnly: true,
    // El navegador no la manda en peticiones que vienen de otros
    // sitios (primera barrera contra CSRF; ver middleware/seguridad.js).
    sameSite: 'strict',
    // Solo por HTTPS cuando COOKIE_SEGURA=true (al desplegar detrás de
    // HTTPS). En local (http://localhost) tiene que estar apagado o
    // el navegador no guardaría la cookie.
    secure: process.env.COOKIE_SEGURA === 'true',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use(verificarOrigen);

// ── Rutas ────────────────────────────────────────────────────

// Verificación de que la API está viva (pública, sin datos).
app.get('/api/status', (req, res) => {
  res.json({ mensaje: 'StudyFlow API funcionando correctamente' });
});

// Registro / login / logout: públicas (naturalmente).
app.use('/api/auth', auth);

// Todo lo demás maneja datos del usuario: requiere sesión, y cada
// router además filtra por req.session.usuarioId.
app.use('/api/entregables', requerirSesion, entregables);
app.use('/api/horarios-fijos', requerirSesion, horarios);
app.use('/api/plan', requerirSesion, plan);
app.use('/api/configuracion', requerirSesion, configuracion);

// ── 404 y errores ────────────────────────────────────────────
// Si ningún router manejó la petición, respondemos con JSON en
// lugar del HTML por defecto de Express.
app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada` });
});

// Manejador de errores: nunca se devuelve el stack trace ni detalles
// internos al cliente (Express por defecto los imprime fuera de producción).
// Los 4 parámetros son obligatorios: así Express reconoce que es un
// manejador de errores (aunque "next" no se use).
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido' });
  }

  // El detalle SOLO va al log del servidor (Runtime Logs de Vercel), nunca
  // al cliente. Sin esta línea un 500 no deja rastro y no se puede
  // diagnosticar. Solo se registra el mensaje y el código, no el objeto
  // completo, para no volcar datos de la conexión.
  console.error('Error no controlado:', req.method, req.path, err.code || '', err.message);

  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
