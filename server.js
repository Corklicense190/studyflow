// ============================================================
// server.js
// Punto de entrada de la aplicación StudyFlow.
// Responsabilidades:
//   1. Crear la app Express y configurar middlewares globales.
//   2. Registrar los routers de cada recurso bajo /api.
//   3. Arrancar el servidor en el puerto 3000.
// ============================================================

const express      = require('express');
const entregables  = require('./routes/entregables');
const horarios     = require('./routes/horarios');

// Creamos la instancia principal de Express.
const app  = express();
const PORT = 3000;

// ── Middlewares globales ─────────────────────────────────────

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
});
