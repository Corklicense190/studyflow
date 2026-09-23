// ============================================================
// db/database.js
// Responsabilidad: abrir (o crear) la base de datos SQLite y
// asegurarse de que las tres tablas existan antes de que
// cualquier ruta intente usarlas.
// ============================================================

// better-sqlite3 funciona de forma SÍNCRONA, lo que simplifica
// el código porque no necesitamos async/await en las consultas.
const Database = require('better-sqlite3');
const path     = require('path');

// Ruta absoluta al archivo .db (queda en la raíz del proyecto).
const dbPath = path.join(__dirname, '..', 'studyflow.db');

// Abrimos o creamos la base de datos.
const db = new Database(dbPath);

// Activar claves foráneas (SQLite las desactiva por defecto).
db.pragma('foreign_keys = ON');

// ── Tabla 1: entregables ─────────────────────────────────────
// Guarda tareas, exámenes y proyectos pendientes del alumno.
db.exec(`
  CREATE TABLE IF NOT EXISTS entregables (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    materia           TEXT    NOT NULL,
    tipo              TEXT    NOT NULL,
    fecha_limite      TEXT    NOT NULL,
    dificultad        INTEGER NOT NULL CHECK(dificultad BETWEEN 1 AND 5),
    duracion_estimada INTEGER NOT NULL,
    creado_en         TEXT    DEFAULT (datetime('now'))
  );
`);

// ── Tabla 2: horarios_fijos ──────────────────────────────────
// Compromisos recurrentes (clases, trabajo…) que el generador
// de horarios debe respetar al planificar el estudio.
db.exec(`
  CREATE TABLE IF NOT EXISTS horarios_fijos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dia_semana  TEXT NOT NULL CHECK(dia_semana IN (
                  'lunes','martes','miercoles','jueves',
                  'viernes','sabado','domingo'
                )),
    hora_inicio TEXT NOT NULL,
    hora_fin    TEXT NOT NULL,
    descripcion TEXT
  );
`);

// ── Tabla 3: bloques_estudio ─────────────────────────────────
// Bloques de tiempo que el algoritmo asigna a cada entregable.
db.exec(`
  CREATE TABLE IF NOT EXISTS bloques_estudio (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    entregable_id  INTEGER NOT NULL REFERENCES entregables(id) ON DELETE CASCADE,
    fecha          TEXT    NOT NULL,
    hora_inicio    TEXT    NOT NULL,
    hora_fin       TEXT    NOT NULL,
    completado     INTEGER DEFAULT 0
  );
`);

// ── Tabla 4: configuracion ───────────────────────────────────
// Una sola fila (forzado con CHECK(id = 1)) que guarda los
// parámetros del algoritmo que el usuario puede ajustar: límite
// de horas de estudio por día y la ventana horaria del día en la
// que se puede estudiar. Antes vivían como constantes fijas
// dentro de algoritmo/priorizar.js; ahora ese módulo sigue
// teniéndolas como valores por defecto, pero routes/plan.js lee
// esta tabla y se las manda como "opciones" en cada generación.
db.exec(`
  CREATE TABLE IF NOT EXISTS configuracion (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    limite_horas_dia  INTEGER NOT NULL DEFAULT 4,
    ventana_inicio    TEXT    NOT NULL DEFAULT '07:00',
    ventana_fin       TEXT    NOT NULL DEFAULT '22:00'
  );
`);

// Nos aseguramos de que la fila única exista desde el arranque,
// así routes/configuracion.js siempre puede hacer UPDATE directo
// sin preguntarse primero si ya hay algo que actualizar.
db.exec(`
  INSERT OR IGNORE INTO configuracion (id, limite_horas_dia, ventana_inicio, ventana_fin)
  VALUES (1, 4, '07:00', '22:00');
`);

// Exportamos la conexión para que los routers la reutilicen.
module.exports = db;
