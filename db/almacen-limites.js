// ============================================================
// db/almacen-limites.js
// Almacén de contadores para express-rate-limit sobre PostgreSQL
// (tabla "limites_intentos").
//
// Por qué no el almacén en memoria que trae la librería: en
// serverless (Vercel) cada petición puede ejecutarse en una instancia
// distinta y con memoria propia, así que un atacante repartiría sus
// intentos entre instancias y nunca llegaría al límite. Con el
// contador en la base de datos todas las instancias cuentan sobre la
// misma tabla y el límite (10 intentos fallidos por IP) es real.
// ============================================================

const db = require('./database');

class AlmacenLimitesPostgres {
  // "prefijo" separa a los distintos limitadores (login, registro) para
  // que no compartan contador.
  constructor(prefijo) {
    this.prefijo = prefijo;
    // El contador vive en la base de datos, compartido entre instancias.
    this.localKeys = false;
  }

  // express-rate-limit la llama al arrancar con sus opciones.
  init(opciones) {
    this.ventanaMs = opciones.windowMs;
  }

  clave(clave) {
    return `${this.prefijo}:${clave}`;
  }

  // Suma un intento y devuelve el total dentro de la ventana actual.
  // Es UNA sola sentencia atómica: si dos peticiones llegan a la vez,
  // ninguna se pierde. Si la ventana anterior ya venció, el contador
  // reinicia en 1.
  async increment(clave) {
    const ahora = Date.now();
    const reinicia = ahora + this.ventanaMs;

    const fila = await db.consultarUna(
      `INSERT INTO limites_intentos (clave, aciertos, reinicia_en) VALUES ($1, 1, $2)
       ON CONFLICT (clave) DO UPDATE SET
         aciertos = CASE WHEN limites_intentos.reinicia_en <= $3 THEN 1 ELSE limites_intentos.aciertos + 1 END,
         reinicia_en = CASE WHEN limites_intentos.reinicia_en <= $3 THEN $2 ELSE limites_intentos.reinicia_en END
       RETURNING aciertos, reinicia_en`,
      [this.clave(clave), reinicia, ahora]
    );

    return { totalHits: fila.aciertos, resetTime: new Date(fila.reinicia_en) };
  }

  // Se usa con skipSuccessfulRequests: un login correcto le "devuelve"
  // el intento que había sumado.
  async decrement(clave) {
    await db.ejecutar(
      'UPDATE limites_intentos SET aciertos = CASE WHEN aciertos > 0 THEN aciertos - 1 ELSE 0 END WHERE clave = $1',
      [this.clave(clave)]
    );
  }

  async resetKey(clave) {
    await db.ejecutar('DELETE FROM limites_intentos WHERE clave = $1', [this.clave(clave)]);
  }
}

module.exports = AlmacenLimitesPostgres;
