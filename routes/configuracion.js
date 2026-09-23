// ============================================================
// routes/configuracion.js
// Router para la fila única de "configuracion": límite diario de
// estudio y ventana horaria (inicio/fin) que usa el algoritmo.
// routes/plan.js lee esta tabla antes de llamar a
// algoritmo/priorizar.js, así el usuario puede ajustarlo desde
// el frontend en vez de tener valores fijos en el código.
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

// ── GET /api/configuracion ───────────────────────────────────
router.get('/', (req, res) => {
  try {
    const configuracion = db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
    res.json(configuracion);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener la configuración', detalle: err.message });
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
  // Si solo viene uno, se compara contra el valor ya guardado.
  body('ventana_fin').custom((ventanaFin, { req }) => {
    if (!ventanaFin) return true;

    const inicio = req.body.ventana_inicio
      || db.prepare('SELECT ventana_inicio FROM configuracion WHERE id = 1').get().ventana_inicio;

    if (ventanaFin <= inicio) {
      throw new Error('ventana_inicio debe ser anterior a ventana_fin');
    }
    return true;
  }),

  manejarErroresValidacion,
  (req, res) => {
    const { limite_horas_dia, ventana_inicio, ventana_fin } = req.body;

    try {
      db.prepare(`
        UPDATE configuracion
        SET limite_horas_dia = COALESCE(?, limite_horas_dia),
            ventana_inicio   = COALESCE(?, ventana_inicio),
            ventana_fin      = COALESCE(?, ventana_fin)
        WHERE id = 1
      `).run(limite_horas_dia, ventana_inicio || null, ventana_fin || null);

      const actualizada = db.prepare('SELECT * FROM configuracion WHERE id = 1').get();

      res.json({
        mensaje: 'Configuración actualizada correctamente',
        configuracion: actualizada,
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar la configuración', detalle: err.message });
    }
  }
);

module.exports = router;
