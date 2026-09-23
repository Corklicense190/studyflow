// ============================================================
// server.js
// Punto de entrada de la aplicación StudyFlow.
// Responsabilidades:
//   1. Crear la app Express y configurar middlewares globales.
//   2. Registrar los routers de cada recurso bajo /api.
//   3. Arrancar el servidor en el puerto 3000.
// ============================================================

// dotenv carga las variables de .env en process.env. Se llama
// antes que cualquier otro require que las use.
require('dotenv').config();

const path         = require('path');
const express      = require('express');
const helmet       = require('helmet');
const entregables  = require('./routes/entregables');
const horarios     = require('./routes/horarios');
const plan         = require('./routes/plan');
const configuracion = require('./routes/configuracion');

// Creamos la instancia principal de Express.
const app  = express();

// Si no hay .env (o no define PORT), cae en 3000 por defecto.
const PORT = process.env.PORT || 3000;

// ── Middlewares globales ─────────────────────────────────────

// Helmet agrega headers de seguridad HTTP (X-Content-Type-Options,
// X-Frame-Options, Content-Security-Policy basica, etc.) con
// valores por defecto razonables. Va primero, antes de cualquier
// otra cosa, para que aplique a toda respuesta sin excepcion.
//
// El CSP por defecto de Helmet ya es compatible con el frontend
// sin abrir ninguna excepcion: el CSS de Tailwind se sirve
// PRE-COMPILADO (npm run build:css), no hay scripts externos ni
// 'unsafe-eval', y todo el JS/CSS es propio ('self'). A proposito
// se evito el CDN de Tailwind (compila en el navegador con JS y
// necesitaria relajar el CSP), justo para no tener que tocar esto.
app.use(helmet());

// express.json() parsea el cuerpo de las peticiones que lleguen
// con Content-Type: application/json y lo deja disponible en
// req.body. Sin esto, req.body sería undefined.
app.use(express.json());

// Sirve el frontend estatico (public/index.html, css, js). Express
// ya resuelve "/" -> "public/index.html" automaticamente si existe.
app.use(express.static(path.join(__dirname, 'public')));

// ── Registro de routers ──────────────────────────────────────

// Cualquier petición que empiece con /api/entregables la maneja
// el router definido en routes/entregables.js.
app.use('/api/entregables', entregables);

// Cualquier petición que empiece con /api/horarios-fijos la
// maneja el router definido en routes/horarios.js.
app.use('/api/horarios-fijos', horarios);

// Cualquier petición que empiece con /api/plan la maneja el
// router definido en routes/plan.js (genera y consulta el
// horario de estudio calculado por el algoritmo).
app.use('/api/plan', plan);

// Cualquier petición que empiece con /api/configuracion la maneja
// el router definido en routes/configuracion.js (límite diario y
// ventana horaria que usa el algoritmo).
app.use('/api/configuracion', configuracion);

// ── Ruta de verificación de la API ────────────────────────────
// "/" ahora la sirve el frontend estatico (public/index.html).
// Esta ruta queda para confirmar rápidamente que el servidor y
// la API siguen vivos sin depender del frontend.
app.get('/api/status', (req, res) => {
  res.json({ mensaje: 'StudyFlow API funcionando correctamente 🎓' });
});

// ── Middleware de manejo de rutas no encontradas (404) ────────
// Si ningún router anterior manejó la petición, respondemos con
// un JSON de error en lugar del HTML por defecto de Express.
app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada` });
});

// ── Arranque del servidor ────────────────────────────────────
// .listen() pone el servidor a escuchar en el puerto indicado.
// El callback se ejecuta una sola vez, cuando el servidor está listo.
app.listen(PORT, () => {
  console.log(`✅ StudyFlow escuchando en http://localhost:${PORT}`);
  console.log('   Rutas disponibles:');
  console.log('   GET    /                       (frontend)');
  console.log('   GET    /api/status');
  console.log('   POST   /api/entregables');
  console.log('   GET    /api/entregables');
  console.log('   PUT    /api/entregables/:id');
  console.log('   DELETE /api/entregables/:id');
  console.log('   POST   /api/horarios-fijos');
  console.log('   GET    /api/horarios-fijos');
  console.log('   PUT    /api/horarios-fijos/:id');
  console.log('   DELETE /api/horarios-fijos/:id');
  console.log('   POST   /api/plan/generar');
  console.log('   GET    /api/plan');
  console.log('   GET    /api/configuracion');
  console.log('   PUT    /api/configuracion');
});
