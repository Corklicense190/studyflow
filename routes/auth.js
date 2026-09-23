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
//   - Límite de intentos por IP (express-rate-limit) contra fuerza bruta.
//   - Cookie httpOnly (JavaScript no puede leerla, así un XSS no la
//     roba) y SameSite=Strict (ver app.js).
// ============================================================

const express   = require('express');
const bcrypt    = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const db = require('../db/database');
const { requerirSesion } = require('../middleware/seguridad');

const router = express.Router();

// Costo de bcrypt: cada +1 duplica el tiempo de cálculo. 12 es un
// valor razonable hoy (~250 ms por contraseña); en pruebas se baja
// a 4 solo para que la suite no tarde.
const COSTO_BCRYPT = process.env.NODE_ENV === 'test' ? 4 : 12;

// Hash de una contraseña que nadie conoce, para el caso "usuario
// inexistente" del login (ver arriba).
const HASH_SENUELO = bcrypt.hashSync('contrasena-senuelo-que-nadie-usa', COSTO_BCRYPT);

// bcrypt solo considera los primeros 72 BYTES de la contraseña; más
// allá los ignora en silencio. Se rechaza en vez de truncar.
const MAX_BYTES_PASSWORD = 72;

// ── Límites de intentos ──────────────────────────────────────
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Solo cuentan los intentos fallidos: entrar bien no gasta cupo.
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' },
});

const limitadorRegistro = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados registros desde esta dirección. Inténtalo más tarde.' },
});

function manejarErroresValidacion(req, res, next) {
  const errores = validationResult(req);

  if (!errores.isEmpty()) {
    return res.status(400).json({
      error: 'Datos inválidos',
      detalle: errores.array().map(e => ({ campo: e.path, mensaje: e.msg })),
    });
  }

  next();
}

// Al registrarse se validan las reglas completas de usuario y contraseña.
const reglasRegistro = [
  body('nombre_usuario')
    .isString().withMessage('El nombre de usuario es obligatorio')
    .bail()
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage('El nombre de usuario debe tener entre 3 y 30 caracteres')
    .bail()
    .matches(/^[A-Za-z0-9_.-]+$/).withMessage('El nombre de usuario solo puede tener letras, números, punto, guion y guion bajo'),

  body('password')
    .isString().withMessage('La contraseña es obligatoria')
    .bail()
    .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres')
    .bail()
    .custom(valor => Buffer.byteLength(valor, 'utf8') <= MAX_BYTES_PASSWORD)
    .withMessage('La contraseña es demasiado larga (máximo 72 bytes)'),
];

// Al entrar solo se exige que vengan datos: no se le explica a quien
// adivina cuáles son las reglas de las contraseñas.
const reglasLogin = [
  body('nombre_usuario').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Escribe tu nombre de usuario'),
  body('password').isString().isLength({ min: 1, max: 1000 }).withMessage('Escribe tu contraseña'),
];

// Abre la sesión del usuario. regenerate() crea un id de sesión
// NUEVO: si alguien le hubiera plantado un id conocido al navegador
// antes de entrar (fijación de sesión), deja de servirle.
function abrirSesion(req, res, usuario, estadoHttp) {
  req.session.regenerate(errorRegenerar => {
    if (errorRegenerar) {
      return res.status(500).json({ error: 'No se pudo iniciar la sesión' });
    }

    req.session.usuarioId = usuario.id;
    req.session.nombreUsuario = usuario.nombre_usuario;

    req.session.save(errorGuardar => {
      if (errorGuardar) {
        return res.status(500).json({ error: 'No se pudo iniciar la sesión' });
      }

      res.status(estadoHttp).json({ usuario: { id: usuario.id, nombre_usuario: usuario.nombre_usuario } });
    });
  });
}

// ── POST /api/auth/registro ──────────────────────────────────
router.post('/registro', limitadorRegistro, reglasRegistro, manejarErroresValidacion, async (req, res) => {
  const { nombre_usuario, password } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, COSTO_BCRYPT);

    // Usuario y su configuración inicial se crean juntos o no se crea nada.
    const crearUsuario = db.transaction(() => {
      const resultado = db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash) VALUES (?, ?)')
        .run(nombre_usuario, passwordHash);
      const id = Number(resultado.lastInsertRowid);
      db.prepare('INSERT INTO configuracion (usuario_id) VALUES (?)').run(id);
      return id;
    });

    let id;
    try {
      id = crearUsuario();
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
      }
      throw error;
    }

    abrirSesion(req, res, { id, nombre_usuario }, 201);
  } catch {
    res.status(500).json({ error: 'Error al crear la cuenta' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────
router.post('/login', limitadorLogin, reglasLogin, manejarErroresValidacion, async (req, res) => {
  const { nombre_usuario, password } = req.body;

  try {
    const usuario = db.prepare('SELECT id, nombre_usuario, password_hash FROM usuarios WHERE nombre_usuario = ?')
      .get(nombre_usuario);

    // Siempre se hace UNA comparación bcrypt, exista o no el usuario.
    const coincide = await bcrypt.compare(password, usuario ? usuario.password_hash : HASH_SENUELO);

    if (!usuario || !coincide) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    abrirSesion(req, res, usuario, 200);
  } catch {
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
// El frontend lo consulta al cargar para saber si ya hay sesión.
router.get('/me', requerirSesion, (req, res) => {
  res.json({ usuario: { id: req.session.usuarioId, nombre_usuario: req.session.nombreUsuario } });
});

module.exports = router;
