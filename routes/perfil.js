// ============================================================
// routes/perfil.js
// Perfil del usuario: datos personales opcionales (apodo, dónde
// estudia, carrera, algo sobre sí), foto de perfil, y cambio de nombre
// de usuario y de contraseña.
//
// Decisiones de seguridad:
//   - Todo sale de la SESIÓN (req.session.usuarioId), nunca del body:
//     nadie puede leer ni cambiar el perfil de otro usuario.
//   - Cambiar la contraseña o el nombre de usuario exige la contraseña
//     ACTUAL (si alguien se llevara una sesión abierta, no podría
//     quedarse con la cuenta) y tiene límite de intentos.
//   - Al cambiar la contraseña se cierran las demás sesiones abiertas de
//     esa cuenta (otros dispositivos) y se renueva la actual.
//   - Eliminar la cuenta pide la contraseña Y escribir el nombre de usuario
//     (como GitHub al borrar un repositorio), tiene el mismo límite de
//     intentos, y borra todo: datos, foto y sesiones abiertas.
//   - Foto: solo JPEG, PNG o WebP, de hasta 300 KB, y el servidor
//     comprueba la FIRMA real del archivo (los primeros bytes), no solo lo
//     que diga el navegador. Nunca se acepta SVG (puede llevar scripts). Al
//     mostrarla se manda con nosniff y un CSP que prohíbe ejecutar nada.
//   - Los textos se escapan al guardar, igual que "materia".
// ============================================================

const express   = require('express');
const bcrypt    = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body }  = require('express-validator');

const db = require('../db/database');
const AlmacenLimitesPostgres = require('../db/almacen-limites');
const {
  COSTO_BCRYPT,
  POSTGRES_UNIQUE_VIOLATION,
  manejarErroresValidacion,
  reglaNombreUsuario,
  reglaPasswordNueva,
  abrirSesion,
} = require('../middleware/cuenta');

const router = express.Router();

// ── Foto ─────────────────────────────────────────────────────
const FOTO_MAX_BYTES = 300 * 1024;
const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];

// ¿Los primeros bytes del archivo son de verdad los del formato declarado?
function firmaCoincide(archivo, tipo) {
  if (tipo === 'image/jpeg') {
    return archivo.length > 3 && archivo[0] === 0xff && archivo[1] === 0xd8 && archivo[2] === 0xff;
  }
  if (tipo === 'image/png') {
    return archivo.length > 8 && archivo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (tipo === 'image/webp') {
    return archivo.length > 12 && archivo.toString('latin1', 0, 4) === 'RIFF' && archivo.toString('latin1', 8, 12) === 'WEBP';
  }
  return false;
}

// ── Límite de intentos para las acciones que piden la contraseña ─────
// Por USUARIO (no por IP): lo que se protege es adivinar la contraseña de
// una cuenta a la que ya se tiene acceso por una sesión. Solo cuentan los
// intentos fallidos.
const limitadorCuenta = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: new AlmacenLimitesPostgres('cuenta'),
  keyGenerator: (req) => `usuario:${req.session.usuarioId}`,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' },
});

// Toda cuenta nueva o antigua debe tener su fila de perfil; se crea al
// primer uso (así también funciona para cuentas anteriores a esta función).
async function asegurarPerfil(usuarioId) {
  await db.ejecutar('INSERT INTO perfiles (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [usuarioId]);
}

// Regla de un campo de texto opcional del perfil: se recorta, se limita el
// largo y se escapa. Una cadena vacía es válida (borra el dato).
function reglaTexto(campo, max, nombre) {
  return body(campo)
    .optional({ values: 'null' })
    .isString().withMessage(`${nombre} debe ser texto`)
    .bail()
    .trim()
    .isLength({ max }).withMessage(`${nombre} puede tener máximo ${max} caracteres`)
    .escape();
}

// ── GET /api/perfil ──────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    await asegurarPerfil(req.session.usuarioId);

    const perfil = await db.consultarUna(
      `SELECT u.nombre_usuario, u.creado_en,
              p.apodo, p.institucion, p.carrera, p.sobre_mi,
              (p.foto IS NOT NULL) AS tiene_foto, p.foto_version
       FROM usuarios u
       JOIN perfiles p ON p.usuario_id = u.id
       WHERE u.id = $1`,
      [req.session.usuarioId]
    );

    res.json(perfil);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el perfil' });
  }
});

// ── PUT /api/perfil ──────────────────────────────────────────
// Actualiza los datos personales. Cada campo es opcional: solo cambia el
// que venga (una cadena vacía lo borra).
router.put(
  '/',
  reglaTexto('apodo', 40, 'El apodo'),
  reglaTexto('institucion', 100, 'La institución'),
  reglaTexto('carrera', 100, 'La carrera'),
  reglaTexto('sobre_mi', 300, 'El texto sobre ti'),
  manejarErroresValidacion,
  async (req, res) => {
    const { apodo, institucion, carrera, sobre_mi } = req.body;

    try {
      await asegurarPerfil(req.session.usuarioId);

      await db.ejecutar(
        `UPDATE perfiles
         SET apodo       = COALESCE($1::text, apodo),
             institucion = COALESCE($2::text, institucion),
             carrera     = COALESCE($3::text, carrera),
             sobre_mi    = COALESCE($4::text, sobre_mi)
         WHERE usuario_id = $5`,
        [apodo ?? null, institucion ?? null, carrera ?? null, sobre_mi ?? null, req.session.usuarioId]
      );

      res.json({ mensaje: 'Perfil actualizado' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al actualizar el perfil' });
    }
  }
);

// ── GET /api/perfil/foto ─────────────────────────────────────
router.get('/foto', async (req, res) => {
  try {
    const fila = await db.consultarUna(
      'SELECT foto, foto_tipo FROM perfiles WHERE usuario_id = $1 AND foto IS NOT NULL',
      [req.session.usuarioId]
    );

    if (!fila) {
      return res.status(404).json({ error: 'Todavía no tienes foto de perfil' });
    }

    res.set({
      'Content-Type': fila.foto_tipo,
      // Solo el navegador de su dueño la guarda, y la revalida cada vez
      // (la URL lleva ?v=<versión>, así que una foto nueva se ve al instante).
      'Cache-Control': 'private, no-cache',
      // Aunque el contenido fuera otra cosa, el navegador no puede
      // "adivinar" un tipo ejecutable ni correr nada de este archivo.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.send(Buffer.from(fila.foto));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la foto' });
  }
});

// ── PUT /api/perfil/foto ─────────────────────────────────────
// El cuerpo es la imagen tal cual (no JSON). express.raw solo lee los tipos
// permitidos y corta con 413 lo que pase de 300 KB.
router.put(
  '/foto',
  express.raw({ type: TIPOS_FOTO, limit: FOTO_MAX_BYTES }),
  async (req, res) => {
    const tipo = req.is(TIPOS_FOTO);

    if (!tipo || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(415).json({ error: 'Sube una imagen JPEG, PNG o WebP' });
    }

    if (!firmaCoincide(req.body, tipo)) {
      return res.status(415).json({ error: 'El archivo no es una imagen válida' });
    }

    try {
      await asegurarPerfil(req.session.usuarioId);

      const version = Date.now();
      await db.ejecutar(
        'UPDATE perfiles SET foto = $1, foto_tipo = $2, foto_version = $3 WHERE usuario_id = $4',
        [req.body, tipo, version, req.session.usuarioId]
      );

      res.json({ mensaje: 'Foto actualizada', foto_version: version });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar la foto' });
    }
  }
);

// ── DELETE /api/perfil/foto ──────────────────────────────────
router.delete('/foto', async (req, res) => {
  try {
    await db.ejecutar(
      'UPDATE perfiles SET foto = NULL, foto_tipo = NULL, foto_version = $1 WHERE usuario_id = $2',
      [Date.now(), req.session.usuarioId]
    );

    res.json({ mensaje: 'Foto eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la foto' });
  }
});

// Comprueba la contraseña actual del usuario de la sesión. Responde 403
// (no 401: el 401 le indica al frontend que la sesión venció) y devuelve
// null si no coincide.
async function verificarPasswordActual(req, res, passwordActual) {
  const usuario = await db.consultarUna(
    'SELECT id, nombre_usuario, password_hash FROM usuarios WHERE id = $1',
    [req.session.usuarioId]
  );

  if (!usuario || !(await bcrypt.compare(passwordActual, usuario.password_hash))) {
    res.status(403).json({ error: 'La contraseña actual no es correcta' });
    return null;
  }

  return usuario;
}

const reglaPasswordActual = (campo) =>
  body(campo).isString().isLength({ min: 1, max: 1000 }).withMessage('Escribe tu contraseña actual');

// ── PUT /api/perfil/usuario ──────────────────────────────────
// Cambia el nombre de usuario (con el que se inicia sesión).
router.put(
  '/usuario',
  limitadorCuenta,
  reglaNombreUsuario('nombre_usuario'),
  reglaPasswordActual('password_actual'),
  manejarErroresValidacion,
  async (req, res) => {
    const { nombre_usuario, password_actual } = req.body;

    try {
      const usuario = await verificarPasswordActual(req, res, password_actual);
      if (!usuario) return;

      try {
        await db.ejecutar(
          'UPDATE usuarios SET nombre_usuario = $1, nombre_normalizado = $2 WHERE id = $3',
          [nombre_usuario, nombre_usuario.toLowerCase(), usuario.id]
        );
      } catch (error) {
        if (error.code === POSTGRES_UNIQUE_VIOLATION) {
          return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
        }
        throw error;
      }

      req.session.nombreUsuario = nombre_usuario;
      req.session.save(() => {
        res.json({ mensaje: 'Nombre de usuario actualizado', usuario: { id: usuario.id, nombre_usuario } });
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al cambiar el nombre de usuario' });
    }
  }
);

// ── PUT /api/perfil/password ─────────────────────────────────
// Cambia la contraseña. Cierra las demás sesiones de la cuenta.
router.put(
  '/password',
  limitadorCuenta,
  reglaPasswordActual('password_actual'),
  reglaPasswordNueva('password_nueva'),
  manejarErroresValidacion,
  async (req, res) => {
    const { password_actual, password_nueva } = req.body;

    if (password_nueva === password_actual) {
      return res.status(400).json({
        error: 'Datos inválidos',
        detalle: [{ campo: 'password_nueva', mensaje: 'La contraseña nueva debe ser distinta de la actual' }],
      });
    }

    try {
      const usuario = await verificarPasswordActual(req, res, password_actual);
      if (!usuario) return;

      const hashNuevo = await bcrypt.hash(password_nueva, COSTO_BCRYPT);
      await db.ejecutar('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hashNuevo, usuario.id]);

      // Cierra las sesiones de esta cuenta en cualquier otro dispositivo.
      await db.ejecutar(
        `DELETE FROM sesiones WHERE sid <> $1 AND (datos::jsonb ->> 'usuarioId') = $2`,
        [req.sessionID, String(usuario.id)]
      );

      // Y la actual recibe un identificador nuevo.
      abrirSesion(req, res, usuario, 200, { mensaje: 'Contraseña actualizada. Se cerraron tus otras sesiones.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al cambiar la contraseña' });
    }
  }
);

// ── DELETE /api/perfil/cuenta ────────────────────────────────
// Elimina la cuenta y TODO lo que le pertenece. Es irreversible, así que
// exige dos cosas: la contraseña actual y escribir el nombre de usuario
// (lo segundo evita borrarla por un clic o una petición accidental).
// ON DELETE CASCADE se encarga de entregables, bloques de estudio,
// horarios fijos, configuración y perfil (foto incluida).
router.delete(
  '/cuenta',
  limitadorCuenta,
  reglaPasswordActual('password_actual'),
  body('confirmacion').isString().withMessage('Escribe tu nombre de usuario para confirmar'),
  manejarErroresValidacion,
  async (req, res) => {
    const { password_actual, confirmacion } = req.body;

    try {
      const usuario = await verificarPasswordActual(req, res, password_actual);
      if (!usuario) return;

      if (confirmacion !== usuario.nombre_usuario) {
        return res.status(400).json({
          error: 'Datos inválidos',
          detalle: [{ campo: 'confirmacion', mensaje: 'Escribe tu nombre de usuario exactamente como aparece' }],
        });
      }

      await db.ejecutar('DELETE FROM usuarios WHERE id = $1', [usuario.id]);

      // Cierra TODAS las sesiones de esa cuenta (esta y las de otros dispositivos).
      await db.ejecutar(`DELETE FROM sesiones WHERE (datos::jsonb ->> 'usuarioId') = $1`, [String(usuario.id)]);

      req.session.destroy(() => {
        res.clearCookie('studyflow.sid');
        res.json({ mensaje: 'Tu cuenta y todos tus datos fueron eliminados' });
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al eliminar la cuenta' });
    }
  }
);

module.exports = router;
