// ============================================================
// routes/entregables.js
// Router de Express que expone los endpoints CRUD para la
// tabla "entregables". Cada operación usa consultas
// parametrizadas de better-sqlite3 (nunca concatenación).
//
// SEGURIDAD: toda entrada de usuario pasa por express-validator
// antes de tocar la base de datos. Esto cubre dos huecos que se
// detectaron al probar el endpoint manualmente:
//   1. Inyección de HTML/JS en "materia" (XSS almacenado) — se
//      probó con <script>alert(1)</script> y se guardaba tal cual.
//   2. "fecha_limite" aceptaba cualquier string, no solo fechas
//      reales (ej. "hola" pasaba como fecha límite válida).
// ============================================================

const express = require('express');
const router  = express.Router();
const { body, param, validationResult } = require('express-validator');

// Reutilizamos la conexión ya abierta en db/database.js.
const db = require('../db/database');

// Mismos valores que el CHECK constraint de la tabla en
// db/database.js. Si un "tipo" no está aquí, SQLite lo hubiera
// rechazado de todas formas, pero validarlo antes evita gastar
// una consulta y da un mensaje de error más claro al usuario.
const TIPOS_VALIDOS = ['examen', 'evidencia'];

// ── Middleware de manejo de errores de validación ────────────
// Se coloca al final de cada cadena de validaciones. Si alguna
// regla falló, corta la petición aquí con 400 y el detalle de
// qué campo(s) fallaron, sin llegar nunca a tocar la base de datos.
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
// En PUT los campos son opcionales (solo se actualiza lo que
// venga en el body), por eso se arma con una bandera "esOpcional".
function reglasEntregable(esOpcional) {
  const envoltura = (validador) => esOpcional ? validador.optional() : validador;

  return [
    envoltura(body('materia'))
      .trim()
      // .escape() convierte < > & " ' en sus entidades HTML,
      // así "<script>" se guarda como texto inofensivo en vez
      // de código ejecutable si algún día se renderiza en el frontend.
      .escape()
      .isLength({ min: 1, max: 100 })
      .withMessage('materia es obligatoria y debe tener entre 1 y 100 caracteres'),

    envoltura(body('tipo'))
      .trim()
      .isIn(TIPOS_VALIDOS)
      .withMessage(`tipo debe ser uno de: ${TIPOS_VALIDOS.join(', ')}`),

    envoltura(body('fecha_limite'))
      // ISO8601 acepta "2026-03-05" y variantes con hora. Rechaza
      // strings como "hola" o "32/13/2026" que antes se guardaban tal cual.
      .isISO8601()
      .withMessage('fecha_limite debe ser una fecha válida en formato ISO 8601 (ej. 2026-03-05)')
      .bail()
      .toDate(),

    envoltura(body('dificultad'))
      .isInt({ min: 1, max: 5 })
      .withMessage('dificultad debe ser un entero entre 1 y 5')
      .toInt(),

    envoltura(body('duracion_estimada'))
      .isInt({ min: 1 })
      .withMessage('duracion_estimada debe ser un entero positivo (horas totales)')
      .toInt(),
  ];
}

// ── POST /api/entregables ────────────────────────────────────
// Crea un entregable nuevo a partir del JSON que llega en el body.
router.post(
  '/',
  reglasEntregable(false),
  manejarErroresValidacion,
  (req, res) => {
    const { materia, tipo, fecha_limite, dificultad, duracion_estimada } = req.body;

    try {
      const stmt = db.prepare(`
        INSERT INTO entregables (materia, tipo, fecha_limite, dificultad, duracion_estimada)
        VALUES (?, ?, ?, ?, ?)
      `);

      // fecha_limite ya viene convertida a Date por .toDate(); la
      // guardamos como ISO string para mantener el formato de la tabla.
      const resultado = stmt.run(
        materia,
        tipo,
        new Date(fecha_limite).toISOString(),
        dificultad,
        duracion_estimada
      );

      res.status(201).json({
        mensaje: 'Entregable creado exitosamente',
        id: resultado.lastInsertRowid
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al crear el entregable', detalle: err.message });
    }
  }
);

// ── GET /api/entregables ─────────────────────────────────────
// Devuelve todos los entregables ordenados por fecha límite
// (los más urgentes primero).
router.get('/', (req, res) => {
  try {
    const entregables = db.prepare(`
      SELECT * FROM entregables ORDER BY fecha_limite ASC
    `).all();

    res.json(entregables);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener los entregables', detalle: err.message });
  }
});

// ── PUT /api/entregables/:id ─────────────────────────────────
// Actualiza uno o más campos de un entregable existente.
router.put(
  '/:id',
  param('id').isInt({ min: 1 }).withMessage('id debe ser un entero positivo').toInt(),
  reglasEntregable(true),
  manejarErroresValidacion,
  (req, res) => {
    const { id } = req.params;
    const { materia, tipo, fecha_limite, dificultad, duracion_estimada } = req.body;

    try {
      const existente = db.prepare('SELECT id FROM entregables WHERE id = ?').get(id);

      if (!existente) {
        return res.status(404).json({ error: `No existe el entregable con id ${id}` });
      }

      const stmt = db.prepare(`
        UPDATE entregables
        SET materia           = COALESCE(?, materia),
            tipo              = COALESCE(?, tipo),
            fecha_limite      = COALESCE(?, fecha_limite),
            dificultad        = COALESCE(?, dificultad),
            duracion_estimada = COALESCE(?, duracion_estimada)
        WHERE id = ?
      `);

      stmt.run(
        materia,
        tipo,
        fecha_limite ? new Date(fecha_limite).toISOString() : null,
        dificultad,
        duracion_estimada,
        id
      );

      res.json({ mensaje: `Entregable ${id} actualizado correctamente` });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar el entregable', detalle: err.message });
    }
  }
);

// ── DELETE /api/entregables/:id ──────────────────────────────
// Elimina un entregable por su id. Gracias a ON DELETE CASCADE
// definido en bloques_estudio, los bloques asociados también
// se borran automáticamente.
router.delete(
  '/:id',
  param('id').isInt({ min: 1 }).withMessage('id debe ser un entero positivo').toInt(),
  manejarErroresValidacion,
  (req, res) => {
    const { id } = req.params;

    try {
      const existente = db.prepare('SELECT id FROM entregables WHERE id = ?').get(id);

      if (!existente) {
        return res.status(404).json({ error: `No existe el entregable con id ${id}` });
      }

      db.prepare('DELETE FROM entregables WHERE id = ?').run(id);

      res.json({ mensaje: `Entregable ${id} eliminado correctamente` });
    } catch (err) {
      res.status(500).json({ error: 'Error al eliminar el entregable', detalle: err.message });
    }
  }
);

// Exportamos el router para registrarlo en server.js.
module.exports = router;
