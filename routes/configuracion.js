// ============================================================
// routes/configuracion.js
// Configuración del algoritmo DEL USUARIO DE LA SESIÓN: límite
// diario de estudio y ventana horaria (inicio/fin). Cada usuario
// tiene su propia fila en la tabla "configuracion".
// routes/plan.js la lee antes de llamar a algoritmo/priorizar.js.
// ============================================================

const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');

const db = require('../db/database');

// Mismo formato HH:MM en 24 horas que ya usa routes/horarios.js.
const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function manejarErroresValidacion(req, res, next) {
  const errores = validationResult(req);

  if (!errores.isEmpty()) {
    return res.status(400).json({
      error: 'Datos inválidos',
      detalle: errores.array().map(e => ({ campo: e.path, mensaje: e.msg }))
    });
  }

  next();
}

// Devuelve la configuración del usuario; si su fila no existe (no
// debería pasar: se crea al registrarse), la crea con los valores
// por defecto de la tabla.
function obtenerConfiguracion(usuarioId) {
  db.prepare('INSERT OR IGNORE INTO configuracion (usuario_id) VALUES (?)').run(usuarioId);
  return db.prepare('SELECT limite_horas_dia, ventana_inicio, ventana_fin FROM configuracion WHERE usuario_id = ?')
    .get(usuarioId);
}

// ── GET /api/configuracion ───────────────────────────────────
router.get('/', (req, res) => {
  try {
    res.json(obtenerConfiguracion(req.session.usuarioId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la configuración' });
  }
});

// ── PUT /api/configuracion ───────────────────────────────────
// Todos los campos son opcionales (se actualiza solo lo que venga),
// mismo patrón COALESCE que ya usan entregables.js y horarios.js.
router.put(
  '/',
  body('limite_horas_dia')
    .optional()
    .isInt({ min: 1, max: 24 })
    .withMessage('limite_horas_dia debe ser un entero entre 1 y 24')
    .toInt(),

  body('ventana_inicio')
    .optional()
    .trim()
    .matches(REGEX_HORA)
    .withMessage('ventana_inicio debe tener formato HH:MM (24 horas), ej. 07:00'),

  body('ventana_fin')
    .optional()
    .trim()
    .matches(REGEX_HORA)
    .withMessage('ventana_fin debe tener formato HH:MM (24 horas), ej. 22:00'),

  // Si vienen los dos en la misma petición, validamos el orden aquí.
  // Si solo viene uno, se compara contra el valor ya guardado del usuario.
  body('ventana_fin').custom((ventanaFin, { req }) => {
    if (!ventanaFin) return true;

    const inicio = req.body.ventana_inicio || obtenerConfiguracion(req.session.usuarioId).ventana_inicio;

    if (ventanaFin <= inicio) {
      throw new Error('ventana_inicio debe ser anterior a ventana_fin');
    }
    return true;
  }),

  manejarErroresValidacion,
  (req, res) => {
    const { limite_horas_dia, ventana_inicio, ventana_fin } = req.body;
    const usuarioId = req.session.usuarioId;

    try {
      obtenerConfiguracion(usuarioId); // asegura que la fila exista

      db.prepare(`
        UPDATE configuracion
        SET limite_horas_dia = COALESCE(?, limite_horas_dia),
            ventana_inicio   = COALESCE(?, ventana_inicio),
            ventana_fin      = COALESCE(?, ventana_fin)
        WHERE usuario_id = ?
      `).run(limite_horas_dia ?? null, ventana_inicio || null, ventana_fin || null, usuarioId);

      res.json({
        mensaje: 'Configuración actualizada correctamente',
        configuracion: obtenerConfiguracion(usuarioId),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al actualizar la configuración' });
    }
  }
);

module.exports = router;
