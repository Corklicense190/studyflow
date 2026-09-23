// ============================================================
// routes/plan.js
// Conecta el algoritmo puro (algoritmo/priorizar.js) con la
// base de datos real. Es la unica pieza de este router que
// sabe de Express y de SQLite; el algoritmo en si sigue sin
// importar ninguno de los dos.
//
// Por ahora siempre hace RECALCULO TOTAL (borra todos los
// bloques_estudio y los regenera desde cero con todos los
// entregables). La logica incremental de la regla 9 (detectar
// conflicto directo vs. reubicar sin mover lo existente) queda
// como mejora futura, confirmado con el usuario antes de
// construir esta primera version.
// ============================================================

const express = require('express');
const router  = express.Router();

const db = require('../db/database');
const { generarPlanEstudio } = require('../algoritmo/priorizar');

// ── POST /api/plan/generar ────────────────────────────────────
// Dispara la generacion del horario. Se llama explicitamente
// (ej. boton "Generar horario" en el frontend), no automatico.
router.post('/generar', (req, res) => {
  try {
    const entregables   = db.prepare('SELECT * FROM entregables').all();
    const horariosFijos = db.prepare('SELECT * FROM horarios_fijos').all();

    // bloquesExistentes = [] porque este endpoint SIEMPRE hace
    // recalculo total: no importa lo que ya estuviera agendado.
    const { bloques, avisos } = generarPlanEstudio(entregables, horariosFijos, []);

    // db.transaction agrupa el DELETE + los INSERT en una sola
    // operacion atomica: si algo falla a la mitad, no se queda
    // la base de datos con un horario a medio borrar.
    const regenerarHorario = db.transaction(() => {
      db.prepare('DELETE FROM bloques_estudio').run();

      const insertar = db.prepare(`
        INSERT INTO bloques_estudio (entregable_id, fecha, hora_inicio, hora_fin)
        VALUES (?, ?, ?, ?)
      `);

      for (const bloque of bloques) {
        insertar.run(bloque.entregable_id, bloque.fecha, bloque.hora_inicio, bloque.hora_fin);
      }
    });

    regenerarHorario();

    res.status(201).json({
      mensaje: `Horario regenerado: ${bloques.length} bloques de estudio creados`,
      totalBloques: bloques.length,
      // avisos: entregables a los que no les alcanzo el tiempo antes
      // de su fecha limite (regla 8) — el frontend debe mostrarlos,
      // nunca se pierden en silencio.
      avisos,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al generar el horario de estudio', detalle: err.message });
  }
});

// ── GET /api/plan ─────────────────────────────────────────────
// Devuelve el horario ya generado, con el nombre y tipo de cada
// entregable incluido (join) para que el frontend no tenga que
// hacer una consulta aparte por cada bloque.
router.get('/', (req, res) => {
  try {
    const bloques = db.prepare(`
      SELECT
        bloques_estudio.id,
        bloques_estudio.fecha,
        bloques_estudio.hora_inicio,
        bloques_estudio.hora_fin,
        bloques_estudio.completado,
        entregables.id      AS entregable_id,
        entregables.materia,
        entregables.tipo
      FROM bloques_estudio
      JOIN entregables ON entregables.id = bloques_estudio.entregable_id
      ORDER BY bloques_estudio.fecha ASC, bloques_estudio.hora_inicio ASC
    `).all();

    res.json(bloques);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el horario de estudio', detalle: err.message });
  }
});

module.exports = router;
