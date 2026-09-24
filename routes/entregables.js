// ============================================================
// routes/entregables.js
// Router de Express que expone los endpoints CRUD para la
// tabla "entregables". Cada operación usa consultas
// parametrizadas ($1, $2...), nunca concatenación.
//
// SEGURIDAD: toda entrada de usuario pasa por express-validator
// antes de tocar la base de datos. Esto cubre dos huecos que se
// detectaron al probar el endpoint manualmente:
//   1. Inyección de HTML/JS en "materia" (XSS almacenado) — se
//      probó con <script>alert(1)</script> y se guardaba tal cual.
//   2. "fecha_limite" aceptaba cualquier string, no solo fechas
//      reales (ej. "hola" pasaba como fecha límite válida).
//
// AISLAMIENTO: cada consulta filtra por el usuario de la sesión
// (req.session.usuarioId), que sale de la sesión y NUNCA del body.
// ============================================================

const express = require('express');
const router  = express.Router();
const { body, param, validationResult } = require('express-validator');

// Reutilizamos la conexión ya abierta en db/database.js.
const db = require('../db/database');

// "tipo" no tiene CHECK a nivel de base de datos (db/esquema.sql);
// esta lista es la única fuente de verdad de qué valores se aceptan.
//
// Regla de negocio (confirmada con el usuario): "examen" y
// "evidencia" siempre valen dificultad 5 automático — el profesor
// las califica igual de exigentes sin importar el tema. Solo
// "tarea" deja que el usuario elija la dificultad (1-5), porque
// varía mucho de una tarea a otra.
const TIPOS_VALIDOS = ['examen', 'evidencia', 'tarea'];
const DIFICULTAD_AUTOMATICA = 5;
const TIPOS_CON_DIFICULTAD_AUTOMATICA = ['examen', 'evidencia'];

// Largo máximo de la nota (recordatorio de qué estudiar). Se mide ANTES
// de escapar, para que el límite sea el que el usuario ve al escribir.
const NOTAS_MAX = 500;

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

    // Si viene dificultad, siempre se valida el rango (sin importar
    // el tipo) — el valor real que se guarda se decide después en
    // el handler de la ruta (ver DIFICULTAD_AUTOMATICA más abajo).
    // Es OPCIONAL a propósito, también al crear: para examen y
    // evidencia el frontend no la manda (es automática). Que sea
    // obligatoria para "tarea" lo exige la regla de abajo.
    body('dificultad')
      .optional({ values: 'null' })
      .isInt({ min: 1, max: 5 })
      .withMessage('dificultad debe ser un entero entre 1 y 5')
      .toInt(),

    // Solo al CREAR (esOpcional === false) se exige dificultad para
    // "tarea": en PUT, si no se manda, simplemente se conserva la
    // que ya tenía (mismo criterio que cualquier otro campo opcional).
    body('dificultad').custom((dificultad, { req }) => {
      const esTarea = req.body.tipo === 'tarea';
      const faltaDificultad = dificultad === undefined || dificultad === null || dificultad === '';

      if (!esOpcional && esTarea && faltaDificultad) {
        throw new Error('dificultad es obligatoria para entregables de tipo "tarea"');
      }
      return true;
    }),

    // Nota opcional. Se escapa igual que "materia" (se muestra en el
    // navegador vía innerHTML). Puede venir vacía: en PUT, "" borra la nota.
    body('notas')
      .optional({ values: 'null' })
      .isString()
      .withMessage('notas debe ser texto')
      .bail()
      .trim()
      .isLength({ max: NOTAS_MAX })
      .withMessage(`notas puede tener máximo ${NOTAS_MAX} caracteres`)
      .escape(),

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
  async (req, res) => {
    const { materia, tipo, fecha_limite, dificultad, duracion_estimada, notas } = req.body;

    // "examen" y "evidencia" siempre son dificultad 5 automático,
    // sin importar qué haya mandado el cliente; solo "tarea" respeta
    // el valor que el usuario eligió.
    const dificultadFinal = TIPOS_CON_DIFICULTAD_AUTOMATICA.includes(tipo)
      ? DIFICULTAD_AUTOMATICA
      : dificultad;

    try {
      // fecha_limite ya viene convertida a Date por .toDate(); la
      // guardamos como ISO string para mantener el formato de la tabla.
      // usuario_id sale de la SESIÓN, nunca del body: el cliente no
      // puede crear datos a nombre de otro usuario.
      const fila = await db.consultarUna(
        `INSERT INTO entregables (usuario_id, materia, tipo, fecha_limite, dificultad, duracion_estimada, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          req.session.usuarioId,
          materia,
          tipo,
          new Date(fecha_limite).toISOString(),
          dificultadFinal,
          duracion_estimada,
          notas ?? '',
        ]
      );

      res.status(201).json({
        mensaje: 'Entregable creado exitosamente',
        id: fila.id
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al crear el entregable' });
    }
  }
);

// ── GET /api/entregables ─────────────────────────────────────
// Devuelve todos los entregables ordenados por fecha límite
// (los más urgentes primero).
router.get('/', async (req, res) => {
  try {
    // Solo los del usuario de la sesión.
    const entregables = await db.consultar(
      `SELECT id, materia, tipo, fecha_limite, dificultad, duracion_estimada, notas, creado_en
       FROM entregables
       WHERE usuario_id = $1
       ORDER BY fecha_limite ASC, id ASC`,
      [req.session.usuarioId]
    );

    res.json(entregables);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los entregables' });
  }
});

// ── PUT /api/entregables/:id ─────────────────────────────────
// Actualiza uno o más campos de un entregable existente.
router.put(
  '/:id',
  param('id').isInt({ min: 1 }).withMessage('id debe ser un entero positivo').toInt(),
  reglasEntregable(true),
  manejarErroresValidacion,
  async (req, res) => {
    const { id } = req.params;
    const { materia, tipo, fecha_limite, dificultad, duracion_estimada, notas } = req.body;

    try {
      // El "AND usuario_id = ?" es lo que impide que un usuario edite
      // el entregable de otro adivinando su id (IDOR). Si el id existe
      // pero es de otro usuario, se responde 404 igual que si no existiera.
      const existente = await db.consultarUna(
        'SELECT tipo FROM entregables WHERE id = $1 AND usuario_id = $2',
        [id, req.session.usuarioId]
      );

      if (!existente) {
        return res.status(404).json({ error: `No existe el entregable con id ${id}` });
      }

      // El tipo "efectivo" es el nuevo si lo están cambiando, o el
      // que ya tenía si no vino en el body. Con eso decidimos si la
      // dificultad se fuerza a automática o se respeta la enviada.
      const tipoEfectivo = tipo || existente.tipo;
      const dificultadFinal = TIPOS_CON_DIFICULTAD_AUTOMATICA.includes(tipoEfectivo)
        ? DIFICULTAD_AUTOMATICA
        : (dificultad ?? null); // null -> COALESCE conserva la que ya tenía

      // COALESCE($n, columna): si el campo no vino (null), conserva el
      // valor actual. Los ::tipo le dicen a Postgres de qué tipo es el
      // parámetro cuando llega null.
      await db.ejecutar(
        `UPDATE entregables
         SET materia           = COALESCE($1::text, materia),
             tipo              = COALESCE($2::text, tipo),
             fecha_limite      = COALESCE($3::text, fecha_limite),
             dificultad        = COALESCE($4::integer, dificultad),
             duracion_estimada = COALESCE($5::integer, duracion_estimada),
             notas             = COALESCE($6::text, notas)
         WHERE id = $7 AND usuario_id = $8`,
        [
          materia ?? null,
          tipo ?? null,
          fecha_limite ? new Date(fecha_limite).toISOString() : null,
          dificultadFinal,
          duracion_estimada ?? null,
          notas ?? null,
          id,
          req.session.usuarioId
        ]
      );

      res.json({ mensaje: `Entregable ${id} actualizado correctamente` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al actualizar el entregable' });
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
  async (req, res) => {
    const { id } = req.params;

    try {
      // Un solo DELETE que ya filtra por dueño: si no había nada que
      // borrar (no existe o es de otro usuario), responde 404.
      const { filasAfectadas } = await db.ejecutar(
        'DELETE FROM entregables WHERE id = $1 AND usuario_id = $2',
        [id, req.session.usuarioId]
      );

      if (filasAfectadas === 0) {
        return res.status(404).json({ error: `No existe el entregable con id ${id}` });
      }

      res.json({ mensaje: `Entregable ${id} eliminado correctamente` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al eliminar el entregable' });
    }
  }
);

// Exportamos el router para registrarlo en app.js.
module.exports = router;
