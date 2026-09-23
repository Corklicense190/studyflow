// ============================================================
// routes/horarios.js
// Router de Express para la tabla "horarios_fijos".
// Registra y lista compromisos recurrentes del alumno.
// ============================================================

const express = require('express');
const router  = express.Router();

// Misma conexión que usan los demás routers.
const db = require('../db/database');

// Días válidos según el CHECK constraint de la tabla.
const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

// ── POST /api/horarios-fijos ─────────────────────────────────
// Registra un nuevo compromiso fijo (clase, trabajo, deporte…).
// Campos requeridos: dia_semana, hora_inicio, hora_fin.
// Campo opcional:   descripcion.
router.post('/', (req, res) => {
  const { dia_semana, hora_inicio, hora_fin, descripcion } = req.body;

  // Validación 1: campos obligatorios presentes.
  if (!dia_semana || !hora_inicio || !hora_fin) {
    return res.status(400).json({
      error: 'Faltan campos obligatorios: dia_semana, hora_inicio, hora_fin'
    });
  }

  // Validación 2: el día debe ser uno de los valores permitidos.
  if (!DIAS_VALIDOS.includes(dia_semana.toLowerCase())) {
    return res.status(400).json({
      error: `dia_semana inválido. Valores permitidos: ${DIAS_VALIDOS.join(', ')}`
    });
  }

  // Validación 3: hora_inicio debe ser anterior a hora_fin.
  // Comparamos strings HH:MM directamente (funciona porque el
  // formato es fijo y lexicográfico == cronológico).
  if (hora_inicio >= hora_fin) {
    return res.status(400).json({
      error: 'hora_inicio debe ser anterior a hora_fin'
    });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO horarios_fijos (dia_semana, hora_inicio, hora_fin, descripcion)
      VALUES (?, ?, ?, ?)
    `);

    // Si descripcion no vino en el body, insertamos NULL.
    const resultado = stmt.run(dia_semana.toLowerCase(), hora_inicio, hora_fin, descripcion || null);

    res.status(201).json({
      mensaje: 'Horario fijo registrado exitosamente',
      id: resultado.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar el horario fijo', detalle: err.message });
  }
});

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
