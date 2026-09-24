// ============================================================
// db/database.js
// Conexión a PostgreSQL (Supabase) y pequeñas funciones de ayuda
// para consultar. Todas las rutas usan SOLO estas funciones, y
// TODAS las consultas van parametrizadas ($1, $2...): los datos del
// usuario nunca se concatenan dentro del SQL (previene inyección SQL).
//
// Diferencia importante con la versión anterior (SQLite): Postgres
// se consulta por red, así que todo es asíncrono (await).
//
// Todos los datos de la app pertenecen a un usuario (usuario_id) y
// las rutas siempre filtran por el de la sesión, así que un usuario
// nunca puede ver ni tocar los datos de otro.
// ============================================================

const fs   = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// Postgres devuelve los BIGINT como texto (para no perder precisión).
// Los nuestros (marcas de tiempo en milisegundos) caben de sobra en un
// número de JavaScript, así que se convierten.
types.setTypeParser(20, Number);

// Las pruebas automáticas (Jest) usan PGlite: el motor REAL de
// PostgreSQL compilado a WebAssembly, corriendo en memoria. Es Postgres
// de verdad (mismas reglas, mismos códigos de error, ROLLBACK real), sin
// instalar nada ni tocar ninguna base real, y cada archivo de pruebas
// arranca con una base vacía. JEST_WORKER_ID lo define Jest; en un
// servidor real nunca existe, así que no hay forma de que producción
// caiga en la base en memoria.
const enPruebas = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

// Solo se usa en pruebas (ver crearPool y transaccion).
let motorPGlite = null;

function crearPool() {
  if (enPruebas) {
    const { PGlite } = require('@electric-sql/pglite');
    motorPGlite = new PGlite();

    // Adaptador mínimo con la misma forma que pg.Pool (solo query).
    return {
      query: async (sql, parametros) => {
        const resultado = await motorPGlite.query(sql, parametros);
        return { rows: resultado.rows, rowCount: resultado.affectedRows ?? resultado.rows.length };
      },
    };
  }

  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'Falta DATABASE_URL (la cadena de conexión de Supabase). ' +
      'Revisa .env.example o DESPLIEGUE.md.'
    );
  }

  // Se quita "sslmode" de la URL: el cifrado se configura abajo, en un
  // solo lugar, y así ningún parámetro de la URL lo puede pisar.
  const conexion = new URL(url);
  conexion.searchParams.delete('sslmode');

  // Cifrado de la conexión con la base de datos:
  //   - DATABASE_CA presente: se verifica el certificado del servidor
  //     contra esa CA (el certificado raíz que Supabase publica). Es lo
  //     correcto: evita que alguien en medio del camino se haga pasar
  //     por la base de datos.
  //   - Ausente: la conexión va cifrada pero NO se verifica la identidad
  //     del servidor. Funciona, pero queda expuesta a ese ataque; por eso
  //     se avisa en producción.
  //   - DATABASE_SSL=false: solo para un Postgres local de desarrollo.
  let ssl;
  if (process.env.DATABASE_SSL === 'false') {
    ssl = false;
  } else if (process.env.DATABASE_CA) {
    // Las variables de entorno de una sola línea traen los saltos de
    // línea del certificado como "\n" literal; se restauran.
    ssl = { ca: process.env.DATABASE_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  } else {
    ssl = { rejectUnauthorized: false };
    if (process.env.NODE_ENV === 'production') {
      console.warn('⚠️  DATABASE_CA no está definido: la conexión a la base de datos va cifrada pero no se verifica el certificado del servidor.');
    }
  }

  const pool = new Pool({
    connectionString: conexion.toString(),
    ssl,
    // En serverless cada instancia abre pocas conexiones (el "pooler" de
    // Supabase multiplica las conexiones hacia Postgres).
    max: Number(process.env.DB_POOL_MAX) || 3,
    idleTimeoutMillis: 10000,
  });

  // Si el servidor cierra una conexión que estaba INACTIVA (el pooler de
  // Supabase lo hace de vez en cuando), el pool emite un evento "error".
  // Un evento "error" sin manejador tira todo el proceso de Node; con este
  // manejador solo se registra, el pool descarta esa conexión y abre otra
  // cuando haga falta.
  pool.on('error', (error) => {
    console.error('Error en una conexión inactiva de la base de datos:', error.message);
  });

  return pool;
}

const pool = crearPool();

// ── Funciones de consulta ────────────────────────────────────

// Devuelve TODAS las filas (un arreglo, vacío si no hay).
async function consultar(sql, parametros = []) {
  const resultado = await pool.query(sql, parametros);
  return resultado.rows;
}

// Devuelve la primera fila, o null si no hay ninguna.
async function consultarUna(sql, parametros = []) {
  const filas = await consultar(sql, parametros);
  return filas.length > 0 ? filas[0] : null;
}

// Para INSERT/UPDATE/DELETE cuando importa cuántas filas se afectaron.
async function ejecutar(sql, parametros = []) {
  const resultado = await pool.query(sql, parametros);
  return { filasAfectadas: resultado.rowCount };
}

// Corre varias consultas como UNA sola operación atómica: o se aplican
// todas o no se aplica ninguna. "trabajo" recibe un objeto con las
// mismas funciones consultar/consultarUna/ejecutar, atadas a la misma
// conexión (una transacción vive en una sola conexión).
async function transaccion(trabajo) {
  // En pruebas (PGlite, una sola conexión) se usa su propia transacción,
  // que además bloquea otras consultas mientras dura, como haría una
  // conexión exclusiva. Si "trabajo" lanza un error, hace ROLLBACK.
  if (motorPGlite) {
    return motorPGlite.transaction(async (tx) => trabajo({
      consultar: async (sql, parametros = []) => (await tx.query(sql, parametros)).rows,
      consultarUna: async (sql, parametros = []) => (await tx.query(sql, parametros)).rows[0] || null,
      ejecutar: async (sql, parametros = []) => {
        const resultado = await tx.query(sql, parametros);
        return { filasAfectadas: resultado.affectedRows ?? resultado.rows.length };
      },
    }));
  }

  const cliente = await pool.connect();

  const enCliente = {
    consultar: async (sql, parametros = []) => (await cliente.query(sql, parametros)).rows,
    consultarUna: async (sql, parametros = []) => (await cliente.query(sql, parametros)).rows[0] || null,
    ejecutar: async (sql, parametros = []) => ({ filasAfectadas: (await cliente.query(sql, parametros)).rowCount }),
  };

  try {
    await cliente.query('BEGIN');
    const resultado = await trabajo(enCliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    try { await cliente.query('ROLLBACK'); } catch { /* la conexión ya falló: se descarta */ }
    throw error;
  } finally {
    cliente.release();
  }
}

// ── Esquema ──────────────────────────────────────────────────

// Aplica db/esquema.sql (idempotente). Se hace solo en las pruebas y
// cuando MIGRAR_AL_ARRANCAR=true (útil en desarrollo). En producción NO
// se corre solo: el esquema se aplica una vez, a mano, en el SQL Editor
// de Supabase (ver DESPLIEGUE.md). Así ningún arranque en frío de una
// función serverless ejecuta DDL, y varias instancias no compiten.
async function aplicarEsquema() {
  const sql = fs.readFileSync(path.join(__dirname, 'esquema.sql'), 'utf8');

  const sentencias = sql
    .split('\n')
    .filter(linea => !linea.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const sentencia of sentencias) {
    await pool.query(sentencia);
  }
}

// Promesa que se cumple cuando la base de datos está lista para usarse.
// app.js la espera antes de atender peticiones.
const listo = (enPruebas || process.env.MIGRAR_AL_ARRANCAR === 'true')
  ? aplicarEsquema()
  : Promise.resolve();
listo.catch(() => { /* el error se le reporta a quien la espere (app.js) */ });

module.exports = { consultar, consultarUna, ejecutar, transaccion, listo };
