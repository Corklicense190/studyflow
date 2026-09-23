// ============================================================
// routes/horarios.js
// Router de Express para la tabla "horarios_fijos".
// Registra y lista compromisos recurrentes del alumno.
//
// SEGURIDAD: mismo criterio que routes/entregables.js — toda
// entrada de usuario pasa por express-validator antes de tocar
// la base de datos. Antes las validaciones eran manuales (if's
// sueltos); se migran aquí para mantener un solo estilo en todo
// el proyecto y que "descripcion" también quede sanitizada
// (antes no se tocaba y podía guardar HTML/JS tal cual).
// ============================================================

const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');

// Misma conexión que usan los demás routers.
const db = require('../db/database');

// Días válidos según el CHECK constraint de la tabla.
const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

// Formato HH:MM en 24 horas (ej. "08:30", "23:00").
const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ── Middleware de manejo de errores de validación ────────────
// Igual que en entregables.js: si algo falló, corta con 400 y
// el detalle de qué campo(s), sin llegar a la base de datos.
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

// ── Reglas de validación para POST /api/horarios-fijos ───────
const reglasHorario = [
  body('dia_semana')
    .trim()
    .toLowerCase()
    .isIn(DIAS_VALIDOS)
    .withMessage(`dia_semana inválido. Valores permitidos: ${DIAS_VALIDOS.join(', ')}`),

  body('hora_inicio')
    .trim()
    .matches(REGEX_HORA)
    .withMessage('hora_inicio debe tener formato HH:MM (24 horas), ej. 08:30'),

  body('hora_fin')
    .trim()
    .matches(REGEX_HORA)
    .withMessage('hora_fin debe tener formato HH:MM (24 horas), ej. 10:00'),

  // Comparamos strings HH:MM directamente: funciona porque el
  // formato ya quedó validado arriba y es lexicográfico == cronológico.
  body('hora_fin').custom((hora_fin, { req }) => {
    if (req.body.hora_inicio && hora_fin <= req.body.hora_inicio) {
      throw new Error('hora_inicio debe ser anterior a hora_fin');
    }
    return true;
  }),

  // descripcion es opcional; si viene, se recorta y se escapa
  // igual que "materia" en entregables.js para evitar XSS.
  body('descripcion')
    .optional({ checkFalsy: true })
    .trim()
    .escape()
    .isLength({ max: 200 })
    .withMessage('descripcion no puede superar 200 caracteres'),
];

// ── POST /api/horarios-fijos ─────────────────────────────────
// Registra un nuevo compromiso fijo (clase, trabajo, deporte…).
// Campos requeridos: dia_semana, hora_inicio, hora_fin.
// Campo opcional:   descripcion.
router.post(
  '/',
  reglasHorario,
  manejarErroresValidacion,
  (req, res) => {
    const { dia_semana, hora_inicio, hora_fin, descripcion } = req.body;

    try {
      const stmt = db.prepare(`
        INSERT INTO horarios_fijos (dia_semana, hora_inicio, hora_fin, descripcion)
        VALUES (?, ?, ?, ?)
      `);

      // Si descripcion no vino en el body, insertamos NULL.
      const resultado = stmt.run(dia_semana, hora_inicio, hora_fin, descripcion || null);

      res.status(201).json({
        mensaje: 'Horario fijo registrado exitosamente',
        id: resultado.lastInsertRowid
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al registrar el horario fijo', detalle: err.message });
    }
  }
);

// ── GET /api/horarios-fijos ──────────────────────────────────
// Devuelve todos los compromisos fijos ordenados por día y
// luego por hora de inicio para facilitar su lectura.
router.get('/', (req, res) => {
  try {
    // Ordenamos usando CASE para respetar el orden natural de la
    // semana en lugar del orden alfabético de SQLite.
    const horarios = db.prepare(`
      SELECT * FROM horarios_fijos
      ORDER BY
        CASE dia_semana
          WHEN 'lunes'     THEN 1
          WHEN 'martes'    THEN 2
          WHEN 'miercoles' THEN 3
          WHEN 'jueves'    THEN 4
          WHEN 'viernes'   THEN 5
          WHEN 'sabado'    THEN 6
          WHEN 'domingo'   THEN 7
        END,
        hora_inicio ASC
    `).all();

    res.json(horarios);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener los horarios fijos', detalle: err.message });
  }
});

// Exportamos el router para registrarlo en server.js.
module.exports = router;
