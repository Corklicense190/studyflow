// ============================================================
// routes/plan.js
// Conecta el algoritmo puro (algoritmo/priorizar.js) con la
// base de datos real. Es la unica pieza de este router que
// sabe de Express y de Postgres; el algoritmo en si sigue sin
// importar ninguno de los dos.
//
// Por ahora siempre hace RECALCULO TOTAL (borra todos los
// bloques_estudio del usuario y los regenera desde cero con todos
// sus entregables). La logica incremental de la regla 9 (detectar
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
router.post('/generar', async (req, res) => {
  try {
    // Todo se lee y se escribe SOLO para el usuario de la sesión.
    const usuarioId = req.session.usuarioId;

    const entregables = await db.consultar(
      'SELECT id, materia, tipo, fecha_limite, dificultad, duracion_estimada FROM entregables WHERE usuario_id = $1 ORDER BY id ASC',
      [usuarioId]
    );
    const horariosFijos = await db.consultar(
      'SELECT id, dia_semana, hora_inicio, hora_fin, descripcion FROM horarios_fijos WHERE usuario_id = $1',
      [usuarioId]
    );

    // Si por algún motivo su fila de configuración no existe, se crea
    // con los valores por defecto de la tabla.
    await db.ejecutar('INSERT INTO configuracion (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [usuarioId]);
    const configuracion = await db.consultarUna(
      'SELECT limite_horas_dia, ventana_inicio, ventana_fin FROM configuracion WHERE usuario_id = $1',
      [usuarioId]
    );

    // Los nombres de columnas (snake_case, como toda la BD) se
    // traducen aquí a los nombres que espera "opciones" en
    // algoritmo/priorizar.js (camelCase). Si por algún motivo no
    // hubiera fila de configuración, generarPlanEstudio usa sus
    // propios valores por defecto (undefined simplemente no pisa nada).
    const opciones = configuracion && {
      limiteHorasPorDia: configuracion.limite_horas_dia,
      ventanaInicio: configuracion.ventana_inicio,
      ventanaFin: configuracion.ventana_fin,
    };

    // bloquesExistentes = [] porque este endpoint SIEMPRE hace
    // recalculo total: no importa lo que ya estuviera agendado.
    const { bloques, avisos } = generarPlanEstudio(entregables, horariosFijos, [], opciones);

    // La transaccion agrupa el DELETE + los INSERT en una sola
    // operacion atomica: si algo falla a la mitad, no se queda
    // la base de datos con un horario a medio borrar.
    await db.transaccion(async (tx) => {
      // Solo se borran los bloques de los entregables de ESTE usuario.
      await tx.ejecutar(
        `DELETE FROM bloques_estudio
         WHERE entregable_id IN (SELECT id FROM entregables WHERE usuario_id = $1)`,
        [usuarioId]
      );

      // Todos los bloques en UNA sola sentencia (varias filas en un
      // VALUES) en vez de un INSERT por bloque: la base de datos está
      // al otro lado de la red y cada viaje cuesta decenas de ms.
      // Lo único que se arma con texto son los marcadores ($1, $2...);
      // los valores siempre viajan como parámetros.
      if (bloques.length > 0) {
        const marcadores = bloques
          .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
          .join(', ');
        const valores = bloques.flatMap(b => [b.entregable_id, b.fecha, b.hora_inicio, b.hora_fin]);

        await tx.ejecutar(
          `INSERT INTO bloques_estudio (entregable_id, fecha, hora_inicio, hora_fin) VALUES ${marcadores}`,
          valores
        );
      }
    });

    res.status(201).json({
      mensaje: `Horario regenerado: ${bloques.length} bloques de estudio creados`,
      totalBloques: bloques.length,
      // avisos: entregables a los que no les alcanzo el tiempo antes
      // de su fecha limite (regla 8) — el frontend debe mostrarlos,
      // nunca se pierden en silencio.
      avisos,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el horario de estudio' });
  }
});

// ── GET /api/plan ─────────────────────────────────────────────
// Devuelve el horario ya generado, con el nombre y tipo de cada
// entregable incluido (join) para que el frontend no tenga que
// hacer una consulta aparte por cada bloque.
router.get('/', async (req, res) => {
  try {
    const bloques = await db.consultar(
      `SELECT
         bloques_estudio.id,
         bloques_estudio.fecha,
         bloques_estudio.hora_inicio,
         bloques_estudio.hora_fin,
         bloques_estudio.completado,
         entregables.id      AS entregable_id,
         entregables.materia,
         entregables.tipo,
         entregables.fecha_limite,
         entregables.notas
       FROM bloques_estudio
       JOIN entregables ON entregables.id = bloques_estudio.entregable_id
       WHERE entregables.usuario_id = $1
       ORDER BY bloques_estudio.fecha ASC, bloques_estudio.hora_inicio ASC`,
      [req.session.usuarioId]
    );

    res.json(bloques);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el horario de estudio' });
  }
});

module.exports = router;
