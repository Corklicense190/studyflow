// ============================================================
// server.js
// Punto de entrada de StudyFlow: importa la app ya armada
// (app.js) y la pone a escuchar en el puerto configurado.
// ============================================================

// app.js carga dotenv, así que PORT ya está disponible después.
const app  = require('./app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ StudyFlow escuchando en http://localhost:${PORT}`);
  console.log('   Rutas disponibles:');
  console.log('   GET    /                       (frontend)');
  console.log('   GET    /api/status');
  console.log('   POST   /api/auth/registro      (pública)');
  console.log('   POST   /api/auth/login         (pública)');
  console.log('   POST   /api/auth/logout');
  console.log('   GET    /api/auth/me');
  console.log('   ── requieren sesión ──');
  console.log('   GET/POST       /api/entregables');
  console.log('   PUT/DELETE     /api/entregables/:id');
  console.log('   GET/POST       /api/horarios-fijos');
  console.log('   PUT/DELETE     /api/horarios-fijos/:id');
  console.log('   POST   /api/plan/generar');
  console.log('   GET    /api/plan');
  console.log('   GET/PUT        /api/configuracion');
});
