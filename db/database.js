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

// Exportamos la conexión para que los routers la reutilicen.
module.exports = db;
