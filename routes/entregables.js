// ============================================================
// routes/entregables.js
// Router de Express que expone los endpoints CRUD para la
// tabla "entregables". Cada operación usa consultas
// parametrizadas de better-sqlite3 (nunca concatenación).
// ============================================================

const express = require('express');
const router  = express.Router();

// Reutilizamos la conexión ya abierta en db/database.js.
const db = require('../db/database');

// ── POST /api/entregables ────────────────────────────────────
// Crea un entregable nuevo a partir del JSON que llega en el body.
// Campos requeridos: materia, tipo, fecha_limite, dificultad,
// duracion_estimada.
router.post('/', (req, res) => {
  const { materia, tipo, fecha_limite, dificultad, duracion_estimada } = req.body;

  // Validación básica: si falta algún campo requerido, respondemos
  // con 400 Bad Request antes de tocar la base de datos.
  if (!materia || !tipo || !fecha_limite || !dificultad || !duracion_estimada) {
    return res.status(400).json({
      error: 'Faltan campos obligatorios: materia, tipo, fecha_limite, dificultad, duracion_estimada'
    });
  }

  try {
    // Preparamos la sentencia una sola vez (mejor rendimiento).
    // Los signos "?" son los marcadores de posición que
    // better-sqlite3 reemplaza de forma segura con los valores.
    const stmt = db.prepare(`
      INSERT INTO entregables (materia, tipo, fecha_limite, dificultad, duracion_estimada)
      VALUES (?, ?, ?, ?, ?)
    `);

    // .run() ejecuta la sentencia y devuelve info sobre la operación.
    const resultado = stmt.run(materia, tipo, fecha_limite, dificultad, duracion_estimada);

    // Devolvemos 201 Created con el id generado automáticamente.
    res.status(201).json({
      mensaje: 'Entregable creado exitosamente',
      id: resultado.lastInsertRowid
    });
  } catch (err) {
    // Si SQLite lanza un error (ej. CHECK constraint), lo capturamos.
    res.status(500).json({ error: 'Error al crear el entregable', detalle: err.message });
  }
});

// ── GET /api/entregables ─────────────────────────────────────
// Devuelve todos los entregables ordenados por fecha límite
// (los más urgentes primero).
router.get('/', (req, res) => {
  try {
    // .all() ejecuta un SELECT y retorna un array de objetos.
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
// Solo modifica los campos que vengan en el body; los demás
// quedan igual gracias al COALESCE.
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { materia, tipo, fecha_limite, dificultad, duracion_estimada } = req.body;

  try {
    // Verificamos primero que el entregable exista.
    // .get() devuelve la primera fila o undefined si no existe.
    const existente = db.prepare('SELECT id FROM entregables WHERE id = ?').get(id);

    if (!existente) {
      return res.status(404).json({ error: `No existe el entregable con id ${id}` });
    }

    // COALESCE devuelve el primer valor no nulo: si el campo
    // llegó en el body, lo usa; si no, conserva el valor actual.
    const stmt = db.prepare(`
      UPDATE entregables
      SET materia           = COALESCE(?, materia),
          tipo              = COALESCE(?, tipo),
          fecha_limite      = COALESCE(?, fecha_limite),
          dificultad        = COALESCE(?, dificultad),
          duracion_estimada = COALESCE(?, duracion_estimada)
      WHERE id = ?
    `);

    stmt.run(materia, tipo, fecha_limite, dificultad, duracion_estimada, id);

    res.json({ mensaje: `Entregable ${id} actualizado correctamente` });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar el entregable', detalle: err.message });
  }
});

// ── DELETE /api/entregables/:id ──────────────────────────────
// Elimina un entregable por su id. Gracias a ON DELETE CASCADE
// definido en bloques_estudio, los bloques asociados también
// se borran automáticamente.
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  try {
    // Verificamos que exista antes de intentar borrar.
    const existente = db.prepare('SELECT id FROM entregables WHERE id = ?').get(id);

    if (!existente) {
      return res.status(404).json({ error: `No existe el entregable con id ${id}` });
    }

    db.prepare('DELETE FROM entregables WHERE id = ?').run(id);

    res.json({ mensaje: `Entregable ${id} eliminado correctamente` });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar el entregable', detalle: err.message });
  }
});

// Exportamos el router para registrarlo en server.js.
module.exports = router;
