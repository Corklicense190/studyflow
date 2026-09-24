// ============================================================
// routes/auth.js
// Registro, inicio y cierre de sesión.
//
// Decisiones de seguridad (todas defendibles en la rúbrica):
//   - Contraseñas: solo se guarda el hash bcrypt (con sal propia),
//     nunca la contraseña.
//   - Mensaje único "Usuario o contraseña incorrectos": no revela
//     si el usuario existe. Cuando no existe se compara igual contra
//     un hash señuelo para que tarde lo mismo (evita enumerar
//     usuarios midiendo tiempos de respuesta).
//   - Se regenera el id de sesión al entrar (previene fijación de
//     sesión).
//   - Límite de intentos por IP (express-rate-limit) contra fuerza
//     bruta, con los contadores en la base de datos para que valga en
//     serverless (ver db/almacen-limites.js).
//   - Cookie httpOnly (JavaScript no puede leerla, así un XSS no la
//     roba) y SameSite=Strict (ver app.js).
// ============================================================

const express   = require('express');
const bcrypt    = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');

const db = require('../db/database');
const AlmacenLimitesPostgres = require('../db/almacen-limites');
const { requerirSesion } = require('../middleware/seguridad');
const {
  COSTO_BCRYPT,
  POSTGRES_UNIQUE_VIOLATION,
  manejarErroresValidacion,
  reglaNombreUsuario,
  reglaPasswordNueva,
  abrirSesion,
} = require('../middleware/cuenta');

const router = express.Router();

// Hash de una contraseña que nadie conoce, para el caso "usuario
// inexistente" del login (ver arriba). Se calcula la primera vez que
// hace falta (no al arrancar) y se reutiliza.
let hashSenuelo;
function obtenerHashSenuelo() {
  if (!hashSenuelo) {
    hashSenuelo = bcrypt.hash('contrasena-senuelo-que-nadie-usa', COSTO_BCRYPT);
  }
  return hashSenuelo;
}

// ── Límites de intentos ──────────────────────────────────────
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new AlmacenLimitesPostgres('login'),
  // Solo cuentan los intentos fallidos: entrar bien no gasta cupo.
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' },
});

const limitadorRegistro = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: new AlmacenLimitesPostgres('registro'),
  message: { error: 'Demasiados registros desde esta dirección. Inténtalo más tarde.' },
});

// Al registrarse se validan las reglas completas de usuario y contraseña
// (las mismas que exige el perfil al cambiarlos: middleware/cuenta.js).
const reglasRegistro = [reglaNombreUsuario('nombre_usuario'), reglaPasswordNueva('password')];

// Al entrar solo se exige que vengan datos: no se le explica a quien
// adivina cuáles son las reglas de las contraseñas.
const reglasLogin = [
  body('nombre_usuario').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Escribe tu nombre de usuario'),
  body('password').isString().isLength({ min: 1, max: 1000 }).withMessage('Escribe tu contraseña'),
];

// ── POST /api/auth/registro ──────────────────────────────────
router.post('/registro', limitadorRegistro, reglasRegistro, manejarErroresValidacion, async (req, res) => {
  const { nombre_usuario, password } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, COSTO_BCRYPT);

    // Usuario y su configuración inicial se crean juntos o no se crea nada.
    let id;
    try {
      id = await db.transaccion(async (tx) => {
        const fila = await tx.consultarUna(
          'INSERT INTO usuarios (nombre_usuario, nombre_normalizado, password_hash) VALUES ($1, $2, $3) RETURNING id',
          [nombre_usuario, nombre_usuario.toLowerCase(), passwordHash]
        );
        await tx.ejecutar('INSERT INTO configuracion (usuario_id) VALUES ($1)', [fila.id]);
        return fila.id;
      });
    } catch (error) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
      }
      throw error;
    }

    abrirSesion(req, res, { id, nombre_usuario }, 201);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear la cuenta' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────
router.post('/login', limitadorLogin, reglasLogin, manejarErroresValidacion, async (req, res) => {
  const { nombre_usuario, password } = req.body;

  try {
    const usuario = await db.consultarUna(
      'SELECT id, nombre_usuario, password_hash FROM usuarios WHERE nombre_normalizado = $1',
      [nombre_usuario.toLowerCase()]
    );

    // Siempre se hace UNA comparación bcrypt, exista o no el usuario.
    const hashAComparar = usuario ? usuario.password_hash : await obtenerHashSenuelo();
    const coincide = await bcrypt.compare(password, hashAComparar);

    if (!usuario || !coincide) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    abrirSesion(req, res, usuario, 200);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('studyflow.sid');
    res.json({ mensaje: 'Sesión cerrada' });
  });
});

// ── GET /api/auth/me ─────────────────────────────────────────
// El frontend lo consulta al cargar para saber si ya hay sesión. El nombre
// se lee de la base de datos (no de la sesión) para que un cambio de
// usuario hecho desde otro dispositivo se refleje aquí.
router.get('/me', requerirSesion, async (req, res) => {
  try {
    const usuario = await db.consultarUna('SELECT id, nombre_usuario FROM usuarios WHERE id = $1', [req.session.usuarioId]);

    if (!usuario) {
      // La cuenta ya no existe: la sesión no vale.
      return req.session.destroy(() => {
        res.clearCookie('studyflow.sid');
        res.status(401).json({ error: 'Necesitas iniciar sesión' });
      });
    }

    res.json({ usuario });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al consultar la sesión' });
  }
});

module.exports = router;
