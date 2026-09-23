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

const express      = require('express');
const helmet       = require('helmet');
const entregables  = require('./routes/entregables');
const horarios     = require('./routes/horarios');
const plan         = require('./routes/plan');

// Creamos la instancia principal de Express.
const app  = express();

// Si no hay .env (o no define PORT), cae en 3000 por defecto.
const PORT = process.env.PORT || 3000;

// ── Middlewares globales ─────────────────────────────────────

// Helmet agrega headers de seguridad HTTP (X-Content-Type-Options,
// X-Frame-Options, Content-Security-Policy basica, etc.) con
// valores por defecto razonables. Va primero, antes de cualquier
// otra cosa, para que aplique a toda respuesta sin excepcion.
app.use(helmet());

// express.json() parsea el cuerpo de las peticiones que lleguen
// con Content-Type: application/json y lo deja disponible en
// req.body. Sin esto, req.body sería undefined.
app.use(express.json());

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

// ── Ruta raíz de verificación ────────────────────────────────
// Sirve para confirmar rápidamente que el servidor está vivo
// sin tener que consultar ningún recurso real.
app.get('/', (req, res) => {
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
  console.log('   GET  /');
  console.log('   POST   /api/entregables');
  console.log('   GET    /api/entregables');
  console.log('   PUT    /api/entregables/:id');
  console.log('   DELETE /api/entregables/:id');
  console.log('   POST   /api/horarios-fijos');
  console.log('   GET    /api/horarios-fijos');
  console.log('   POST   /api/plan/generar');
  console.log('   GET    /api/plan');
});
