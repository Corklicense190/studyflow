// ============================================================
// db/almacen-sesiones.js
// Almacén de sesiones de express-session sobre PostgreSQL (tabla
// "sesiones"). En un entorno serverless (Vercel) la memoria NO se
// comparte entre peticiones: cada una puede caer en una instancia
// distinta, así que el MemoryStore por defecto perdería la sesión
// constantemente. Guardarlas en la base de datos las hace válidas para
// cualquier instancia, y permite cerrarlas de verdad en el servidor
// (logout) en vez de depender de que el navegador borre una cookie.
// Se escribió a mano para no sumar otra dependencia (y otra
// superficie de ataque de la cadena de suministro) por ~50 líneas.
//
// La tabla guarda solo el estado de la sesión (id del usuario);
// nunca contraseñas ni hashes.
// ============================================================

const session = require('express-session');
const db      = require('./database');

const OCHO_HORAS_MS = 8 * 60 * 60 * 1000;

// express-session usa callbacks; nuestra base de datos, promesas.
function conCallback(promesa, callback) {
  promesa.then(resultado => callback(null, resultado), error => callback(error));
}

class AlmacenSesionesPostgres extends session.Store {
  // Momento (ms) en que vence la sesión, según su cookie.
  calcularExpira(sesion) {
    const expiraCookie = sesion.cookie && sesion.cookie.expires;
    return expiraCookie ? new Date(expiraCookie).getTime() : Date.now() + OCHO_HORAS_MS;
  }

  get(sid, callback) {
    conCallback((async () => {
      const fila = await db.consultarUna('SELECT datos, expira FROM sesiones WHERE sid = $1', [sid]);

      if (!fila) return null;

      if (fila.expira <= Date.now()) {
        await db.ejecutar('DELETE FROM sesiones WHERE sid = $1', [sid]);
        return null;
      }

      return JSON.parse(fila.datos);
    })(), callback);
  }

  set(sid, sesion, callback) {
    conCallback((async () => {
      await db.ejecutar(
        `INSERT INTO sesiones (sid, datos, expira) VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO UPDATE SET datos = excluded.datos, expira = excluded.expira`,
        [sid, JSON.stringify(sesion), this.calcularExpira(sesion)]
      );
      this.limpiarDeVezEnCuando();
    })(), callback);
  }

  // touch renueva el vencimiento cuando la sesión sigue activa (rolling).
  touch(sid, sesion, callback) {
    conCallback(
      db.ejecutar('UPDATE sesiones SET expira = $2 WHERE sid = $1', [sid, this.calcularExpira(sesion)]),
      callback
    );
  }

  destroy(sid, callback) {
    conCallback(db.ejecutar('DELETE FROM sesiones WHERE sid = $1', [sid]), callback);
  }

  // No hay un proceso que corra "cada X minutos" en serverless, así
  // que la limpieza de filas vencidas (sesiones y contadores del límite
  // de intentos) se hace de paso, en ~2% de las escrituras.
  limpiarDeVezEnCuando() {
    if (Math.random() >= 0.02) return;

    const ahora = Date.now();
    Promise.all([
      db.ejecutar('DELETE FROM sesiones WHERE expira <= $1', [ahora]),
      db.ejecutar('DELETE FROM limites_intentos WHERE reinicia_en <= $1', [ahora]),
    ]).catch(() => { /* limpieza oportunista: si falla, ya se hará después */ });
  }
}

module.exports = AlmacenSesionesPostgres;
