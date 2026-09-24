// ============================================================
// routes/horarios.js
// Router de Express para la tabla "horarios_fijos".
// Registra y lista compromisos recurrentes del alumno.
//
// SEGURIDAD: mismo criterio que routes/entregables.js — toda
// entrada de usuario pasa por express-validator antes de tocar
// la base de datos, "descripcion" se sanitiza (escapa) para evitar
// XSS, y cada consulta filtra por el usuario de la sesión.
// ============================================================

const express = require('express');
const router  = express.Router();
const { body, param, validationResult } = require('express-validator');

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

// ── Reglas de validación compartidas entre POST y PUT ────────
// Igual que en entregables.js: en PUT los campos son opcionales
// (solo se actualiza lo que venga en el body).
function reglasHorario(esOpcional) {
  const envoltura = (validador) => esOpcional ? validador.optional() : validador;

  return [
    envoltura(body('dia_semana'))
      .trim()
      .toLowerCase()
      .isIn(DIAS_VALIDOS)
      .withMessage(`dia_semana inválido. Valores permitidos: ${DIAS_VALIDOS.join(', ')}`),

    envoltura(body('hora_inicio'))
      .trim()
      .matches(REGEX_HORA)
      .withMessage('hora_inicio debe tener formato HH:MM (24 horas), ej. 08:30'),

    envoltura(body('hora_fin'))
      .trim()
      .matches(REGEX_HORA)
      .withMessage('hora_fin debe tener formato HH:MM (24 horas), ej. 10:00'),

    // Comparamos strings HH:MM directamente: funciona porque el
    // formato ya quedó validado arriba y es lexicográfico == cronológico.
    // En PUT, si solo viene uno de los dos campos, no hay con qué
    // comparar (el otro sigue siendo el valor viejo en la BD), así
    // que este chequeo cruzado se salta en ese caso.
    body('hora_fin').custom((hora_fin, { req }) => {
      if (hora_fin && req.body.hora_inicio && hora_fin <= req.body.hora_inicio) {
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
}

// ── POST /api/horarios-fijos ─────────────────────────────────
// Registra un nuevo compromiso fijo (clase, trabajo, deporte…).
// Campos requeridos: dia_semana, hora_inicio, hora_fin.
// Campo opcional:   descripcion.
router.post(
  '/',
  reglasHorario(false),
  manejarErroresValidacion,
  async (req, res) => {
    const { dia_semana, hora_inicio, hora_fin, descripcion } = req.body;

    try {
      // Si descripcion no vino en el body, insertamos NULL. usuario_id
      // sale de la sesión, nunca del body.
      const fila = await db.consultarUna(
        `INSERT INTO horarios_fijos (usuario_id, dia_semana, hora_inicio, hora_fin, descripcion)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [req.session.usuarioId, dia_semana, hora_inicio, hora_fin, descripcion || null]
      );

      res.status(201).json({
        mensaje: 'Horario fijo registrado exitosamente',
        id: fila.id
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al registrar el horario fijo' });
    }
  }
);

// ── GET /api/horarios-fijos ──────────────────────────────────
// Devuelve todos los compromisos fijos ordenados por día y
// luego por hora de inicio para facilitar su lectura.
router.get('/', async (req, res) => {
  try {
    // Ordenamos usando CASE para respetar el orden natural de la
    // semana en lugar del orden alfabético.
    const horarios = await db.consultar(
      `SELECT id, dia_semana, hora_inicio, hora_fin, descripcion
       FROM horarios_fijos
       WHERE usuario_id = $1
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
         hora_inicio ASC`,
      [req.session.usuarioId]
    );

    res.json(horarios);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los horarios fijos' });
  }
});

// ── PUT /api/horarios-fijos/:id ──────────────────────────────
// Actualiza uno o más campos de un horario fijo existente.
router.put(
  '/:id',
  param('id').isInt({ min: 1 }).withMessage('id debe ser un entero positivo').toInt(),
  reglasHorario(true),
  manejarErroresValidacion,
  async (req, res) => {
    const { id } = req.params;
    const { dia_semana, hora_inicio, hora_fin, descripcion } = req.body;

    try {
      // "AND usuario_id = ...": un usuario solo puede tocar sus propios
      // horarios (si el id es de otro usuario, responde 404 igual que
      // si no existiera).
      const { filasAfectadas } = await db.ejecutar(
        `UPDATE horarios_fijos
         SET dia_semana  = COALESCE($1::text, dia_semana),
             hora_inicio = COALESCE($2::text, hora_inicio),
             hora_fin    = COALESCE($3::text, hora_fin),
             descripcion = COALESCE($4::text, descripcion)
         WHERE id = $5 AND usuario_id = $6`,
        [dia_semana || null, hora_inicio || null, hora_fin || null, descripcion || null, id, req.session.usuarioId]
      );

      if (filasAfectadas === 0) {
        return res.status(404).json({ error: `No existe el horario fijo con id ${id}` });
      }

      res.json({ mensaje: `Horario fijo ${id} actualizado correctamente` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al actualizar el horario fijo' });
    }
  }
);

// ── DELETE /api/horarios-fijos/:id ───────────────────────────
router.delete(
  '/:id',
  param('id').isInt({ min: 1 }).withMessage('id debe ser un entero positivo').toInt(),
  manejarErroresValidacion,
  async (req, res) => {
    const { id } = req.params;

    try {
      const { filasAfectadas } = await db.ejecutar(
        'DELETE FROM horarios_fijos WHERE id = $1 AND usuario_id = $2',
        [id, req.session.usuarioId]
      );

      if (filasAfectadas === 0) {
        return res.status(404).json({ error: `No existe el horario fijo con id ${id}` });
      }

      res.json({ mensaje: `Horario fijo ${id} eliminado correctamente` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al eliminar el horario fijo' });
    }
  }
);

// Exportamos el router para registrarlo en app.js.
module.exports = router;
