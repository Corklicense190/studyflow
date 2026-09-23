// ============================================================
// db/almacen-sesiones.js
// Almacén de sesiones de express-session que guarda todo en la
// tabla "sesiones" de SQLite, en vez del MemoryStore por defecto
// (que pierde las sesiones al reiniciar el servidor y la propia
// documentación de express-session dice que no es para uso real).
// Se escribió a mano para no sumar otra dependencia (y otra
// superficie de ataque de la cadena de suministro) por ~40 líneas.
//
// Nota de seguridad: la tabla guarda solo el estado de la sesión
// (id del usuario); nunca contraseñas ni hashes.
// ============================================================

const session = require('express-session');
const db      = require('./database');

const OCHO_HORAS_MS = 8 * 60 * 60 * 1000;
const CADA_QUINCE_MIN_MS = 15 * 60 * 1000;

class AlmacenSesionesSQLite extends session.Store {
  constructor() {
    super();

    // Sentencias preparadas una sola vez (y parametrizadas: el sid
    // viene de una cookie, o sea de entrada no confiable).
    this.sentenciaObtener = db.prepare('SELECT datos, expira FROM sesiones WHERE sid = ?');
    this.sentenciaGuardar = db.prepare(`
      INSERT INTO sesiones (sid, datos, expira) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET datos = excluded.datos, expira = excluded.expira
    `);
    this.sentenciaBorrar  = db.prepare('DELETE FROM sesiones WHERE sid = ?');
    this.sentenciaLimpiar = db.prepare('DELETE FROM sesiones WHERE expira <= ?');

    // Barrido periódico de sesiones vencidas. unref() para que este
    // temporizador no impida que el proceso termine (importante en Jest).
    this.temporizador = setInterval(() => this.sentenciaLimpiar.run(Date.now()), CADA_QUINCE_MIN_MS);
    this.temporizador.unref();
  }

  // Momento (ms) en que vence la sesión, según su cookie.
  calcularExpira(sesion) {
    const expiraCookie = sesion.cookie && sesion.cookie.expires;
    return expiraCookie ? new Date(expiraCookie).getTime() : Date.now() + OCHO_HORAS_MS;
  }

  get(sid, callback) {
    try {
      const fila = this.sentenciaObtener.get(sid);

      if (!fila) return callback(null, null);

      if (fila.expira <= Date.now()) {
        this.sentenciaBorrar.run(sid);
        return callback(null, null);
      }

      callback(null, JSON.parse(fila.datos));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sesion, callback) {
    try {
      this.sentenciaGuardar.run(sid, JSON.stringify(sesion), this.calcularExpira(sesion));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  // touch renueva el vencimiento cuando la sesión sigue activa (rolling).
  touch(sid, sesion, callback) {
    this.set(sid, sesion, callback);
  }

  destroy(sid, callback) {
    try {
      this.sentenciaBorrar.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = AlmacenSesionesSQLite;
