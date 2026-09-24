// ============================================================
// db/database.js
// Responsabilidad: abrir (o crear) la base de datos SQLite y
// asegurarse de que las tablas existan antes de que cualquier
// ruta intente usarlas.
//
// Desde que se agregó autenticación, TODOS los datos de la app
// pertenecen a un usuario (columna usuario_id). Las rutas siempre
// filtran por el usuario de la sesión, así que un usuario nunca
// puede ver ni tocar los entregables, horarios o configuración
// de otro.
// ============================================================

// better-sqlite3 funciona de forma SÍNCRONA, lo que simplifica
// el código porque no necesitamos async/await en las consultas.
const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

// Dónde vive el archivo .db, en este orden:
//   1. DB_PATH, si está definido (las pruebas automáticas usan
//      ':memory:' para no tocar la base de datos real).
//   2. El volumen persistente de Railway (RAILWAY_VOLUME_MOUNT_PATH,
//      que Railway define solo cuando se adjunta un volumen). En un
//      despliegue el disco del contenedor se borra con cada deploy;
//      lo único que sobrevive es el volumen, así que la base de datos
//      TIENE que vivir ahí o se perderían todas las cuentas.
//   3. La raíz del proyecto (desarrollo local).
const dbPath = process.env.DB_PATH
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH && path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'studyflow.db'))
  || path.join(__dirname, '..', 'studyflow.db');

// Si la carpeta no existe todavía (ej. una ruta nueva en DB_PATH),
// se crea; SQLite crea el archivo pero no las carpetas.
if (dbPath !== ':memory:') {
  // La ruta sale de variables de entorno que controla quien despliega
  // el servidor, nunca de una petición de un usuario: no es un vector
  // de path traversal.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// Abrimos o creamos la base de datos.
const db = new Database(dbPath);

// Activar claves foráneas (SQLite las desactiva por defecto).
db.pragma('foreign_keys = ON');

// ── Detección del esquema viejo (anterior a la autenticación) ──
// CREATE TABLE IF NOT EXISTS no modifica tablas que ya existen, así
// que una studyflow.db creada antes de la autenticación se quedaría
// sin la columna usuario_id y todo fallaría con errores confusos.
// Mejor detenerse aquí con un mensaje claro.
const tablaVieja = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entregables'").get();
if (tablaVieja) {
  const columnas = db.prepare('PRAGMA table_info(entregables)').all().map(c => c.name);
  if (!columnas.includes('usuario_id')) {
    throw new Error(
      'La base de datos studyflow.db tiene el esquema anterior a la autenticación (sin usuario_id). ' +
      'Borra el archivo studyflow.db y vuelve a arrancar: se recreará con el esquema nuevo.'
    );
  }
}

// ── Tabla 0: usuarios ────────────────────────────────────────
// La contraseña NUNCA se guarda: solo su hash bcrypt (con sal
// incluida). nombre_usuario es único sin distinguir mayúsculas.
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_usuario  TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT    NOT NULL,
    creado_en       TEXT    DEFAULT (datetime('now'))
  );
`);

// ── Tabla 1: entregables ─────────────────────────────────────
// Guarda tareas, exámenes y evidencias pendientes del alumno.
// ON DELETE CASCADE: si se borra el usuario, se van sus datos.
db.exec(`
  CREATE TABLE IF NOT EXISTS entregables (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
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
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
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
// No lleva usuario_id propio: su dueño es el de su entregable.
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
// Una fila POR USUARIO con los parámetros del algoritmo que puede
// ajustar: límite de horas de estudio por día y ventana horaria.
// Los DEFAULT son los valores confirmados originalmente (4h, 07:00-22:00);
// la fila se crea con esos valores al registrarse o la primera vez
// que se consulta.
db.exec(`
  CREATE TABLE IF NOT EXISTS configuracion (
    usuario_id        INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    limite_horas_dia  INTEGER NOT NULL DEFAULT 4,
    ventana_inicio    TEXT    NOT NULL DEFAULT '07:00',
    ventana_fin       TEXT    NOT NULL DEFAULT '22:00'
  );
`);

// ── Tabla 5: sesiones ────────────────────────────────────────
// Sesiones del servidor (express-session). En el navegador solo
// viaja un identificador aleatorio en una cookie httpOnly; lo demás
// (quién eres) vive aquí. Ver db/almacen-sesiones.js.
db.exec(`
  CREATE TABLE IF NOT EXISTS sesiones (
    sid     TEXT    PRIMARY KEY,
    datos   TEXT    NOT NULL,
    expira  INTEGER NOT NULL
  );
`);

// Exportamos la conexión para que los routers la reutilicen.
module.exports = db;
