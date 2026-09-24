-- ============================================================
-- db/esquema.sql
-- Esquema de StudyFlow para PostgreSQL (Supabase).
-- Es IDEMPOTENTE: se puede correr varias veces sin romper nada
-- (CREATE ... IF NOT EXISTS), así que también sirve para aplicar
-- tablas nuevas en futuras versiones.
--
-- Cómo aplicarlo en Supabase: SQL Editor -> pegar este archivo ->
-- Run. Después correr también db/supabase-seguridad.sql (bloquea el
-- acceso directo a las tablas desde la API pública de Supabase).
--
-- IMPORTANTE: los comentarios de este archivo no llevan punto y
-- coma; el cargador de las pruebas separa las sentencias por ";".
-- ============================================================

-- Usuarios. La contraseña NUNCA se guarda, solo su hash bcrypt.
-- nombre_normalizado es el nombre en minúsculas y es lo que debe ser
-- único (así "Andre" y "ANDRE" son la misma cuenta).
CREATE TABLE IF NOT EXISTS usuarios (
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre_usuario      TEXT NOT NULL,
  nombre_normalizado  TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exámenes, evidencias y tareas de cada usuario.
-- ON DELETE CASCADE: si se borra el usuario se van sus datos.
-- "tipo" se valida en la aplicación (express-validator), no aquí.
CREATE TABLE IF NOT EXISTS entregables (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id         INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  materia            TEXT NOT NULL,
  tipo               TEXT NOT NULL,
  fecha_limite       TEXT NOT NULL,
  dificultad         INTEGER NOT NULL CHECK (dificultad BETWEEN 1 AND 5),
  duracion_estimada  INTEGER NOT NULL,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entregables_usuario_idx ON entregables (usuario_id);

-- Clases y compromisos recurrentes que el algoritmo nunca pisa.
CREATE TABLE IF NOT EXISTS horarios_fijos (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  dia_semana   TEXT NOT NULL CHECK (dia_semana IN ('lunes','martes','miercoles','jueves','viernes','sabado','domingo')),
  hora_inicio  TEXT NOT NULL,
  hora_fin     TEXT NOT NULL,
  descripcion  TEXT
);
CREATE INDEX IF NOT EXISTS horarios_usuario_idx ON horarios_fijos (usuario_id);

-- Resultado del algoritmo. Su dueño es el de su entregable.
CREATE TABLE IF NOT EXISTS bloques_estudio (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entregable_id  INTEGER NOT NULL REFERENCES entregables(id) ON DELETE CASCADE,
  fecha          TEXT NOT NULL,
  hora_inicio    TEXT NOT NULL,
  hora_fin       TEXT NOT NULL,
  completado     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS bloques_entregable_idx ON bloques_estudio (entregable_id);

-- Una fila por usuario con los parámetros del algoritmo.
CREATE TABLE IF NOT EXISTS configuracion (
  usuario_id        INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  limite_horas_dia  INTEGER NOT NULL DEFAULT 4,
  ventana_inicio    TEXT NOT NULL DEFAULT '07:00',
  ventana_fin       TEXT NOT NULL DEFAULT '22:00'
);

-- Color que el usuario eligió para cada tipo de entregable (se ve en el
-- calendario y en la lista). Van como ALTER ... IF NOT EXISTS para que
-- este archivo se pueda volver a correr sobre una base que ya existía
-- y le agregue las columnas nuevas sin tocar nada más. Los valores por
-- defecto son los colores originales de la aplicación.
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS color_examen TEXT NOT NULL DEFAULT '#fb7185';
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS color_evidencia TEXT NOT NULL DEFAULT '#818cf8';
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS color_tarea TEXT NOT NULL DEFAULT '#fbbf24';

-- Sesiones del servidor (express-session). En el navegador solo viaja
-- un identificador aleatorio en una cookie httpOnly. "expira" son
-- milisegundos desde 1970.
CREATE TABLE IF NOT EXISTS sesiones (
  sid     TEXT PRIMARY KEY,
  datos   TEXT NOT NULL,
  expira  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sesiones_expira_idx ON sesiones (expira);

-- Contadores del límite de intentos (contra fuerza bruta). Viven en la
-- base de datos y no en memoria porque en un entorno serverless cada
-- petición puede caer en una instancia distinta y un contador en
-- memoria no serviría de nada.
CREATE TABLE IF NOT EXISTS limites_intentos (
  clave        TEXT PRIMARY KEY,
  aciertos     INTEGER NOT NULL,
  reinicia_en  BIGINT NOT NULL
);
