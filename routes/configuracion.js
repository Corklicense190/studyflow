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

// Color en hexadecimal de 6 dígitos (ej. #fb7185). Se exige ESTE formato
// exacto (no nombres como "red", ni rgb(), ni url()...) porque el valor
// termina dentro de una variable CSS en el navegador: así jamás puede
// colarse CSS ajeno.
const REGEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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
async function obtenerConfiguracion(usuarioId) {
  await db.ejecutar('INSERT INTO configuracion (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [usuarioId]);
  return db.consultarUna(
    `SELECT limite_horas_dia, ventana_inicio, ventana_fin,
            color_examen, color_evidencia, color_tarea
     FROM configuracion WHERE usuario_id = $1`,
    [usuarioId]
  );
}

// ── GET /api/configuracion ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    res.json(await obtenerConfiguracion(req.session.usuarioId));
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

  // Colores por tipo de entregable. Se guardan en minúsculas para que
  // "#FB7185" y "#fb7185" sean el mismo valor.
  body(['color_examen', 'color_evidencia', 'color_tarea'])
    .optional()
    .trim()
    .matches(REGEX_COLOR)
    .withMessage('El color debe ser hexadecimal de 6 dígitos, ej. #fb7185')
    .customSanitizer(valor => valor.toLowerCase()),

  // Si vienen los dos en la misma petición, validamos el orden aquí.
  // Si solo viene uno, se compara contra el valor ya guardado del usuario.
  body('ventana_fin').custom(async (ventanaFin, { req }) => {
    if (!ventanaFin) return true;

    const inicio = req.body.ventana_inicio
      || (await obtenerConfiguracion(req.session.usuarioId)).ventana_inicio;

    if (ventanaFin <= inicio) {
      throw new Error('ventana_inicio debe ser anterior a ventana_fin');
    }
    return true;
  }),

  manejarErroresValidacion,
  async (req, res) => {
    const { limite_horas_dia, ventana_inicio, ventana_fin, color_examen, color_evidencia, color_tarea } = req.body;
    const usuarioId = req.session.usuarioId;

    try {
      await obtenerConfiguracion(usuarioId); // asegura que la fila exista

      await db.ejecutar(
        `UPDATE configuracion
         SET limite_horas_dia = COALESCE($1::integer, limite_horas_dia),
             ventana_inicio   = COALESCE($2::text, ventana_inicio),
             ventana_fin      = COALESCE($3::text, ventana_fin),
             color_examen     = COALESCE($4::text, color_examen),
             color_evidencia  = COALESCE($5::text, color_evidencia),
             color_tarea      = COALESCE($6::text, color_tarea)
         WHERE usuario_id = $7`,
        [
          limite_horas_dia ?? null, ventana_inicio || null, ventana_fin || null,
          color_examen || null, color_evidencia || null, color_tarea || null,
          usuarioId
        ]
      );

      res.json({
        mensaje: 'Configuración actualizada correctamente',
        configuracion: await obtenerConfiguracion(usuarioId),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al actualizar la configuración' });
    }
  }
);

module.exports = router;
