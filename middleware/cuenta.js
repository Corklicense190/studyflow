// ============================================================
// middleware/cuenta.js
// Piezas compartidas por el registro/login (routes/auth.js) y la
// edición de la cuenta desde el perfil (routes/perfil.js): las reglas
// de nombre de usuario y contraseña, el costo de bcrypt y la apertura
// de una sesión nueva. Estar en UN solo lugar garantiza que cambiar la
// contraseña o el usuario exige exactamente lo mismo que al registrarse.
// ============================================================

const { body, validationResult } = require('express-validator');

// Costo de bcrypt: cada +1 duplica el tiempo de cálculo. 12 es un
// valor razonable hoy (~250 ms por contraseña); en pruebas se baja
// a 4 solo para que la suite no tarde.
const COSTO_BCRYPT = process.env.NODE_ENV === 'test' ? 4 : 12;

// bcrypt solo considera los primeros 72 BYTES de la contraseña; más
// allá los ignora en silencio. Se rechaza en vez de truncar.
const MAX_BYTES_PASSWORD = 72;

// Código de error de Postgres para "violación de restricción UNIQUE".
const POSTGRES_UNIQUE_VIOLATION = '23505';

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

// Nombre de usuario: 3-30 caracteres de [A-Za-z0-9_.-]. "campo" es el
// nombre del campo en el body.
function reglaNombreUsuario(campo = 'nombre_usuario') {
  return body(campo)
    .isString().withMessage('El nombre de usuario es obligatorio')
    .bail()
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage('El nombre de usuario debe tener entre 3 y 30 caracteres')
    .bail()
    .matches(/^[A-Za-z0-9_.-]+$/).withMessage('El nombre de usuario solo puede tener letras, números, punto, guion y guion bajo');
}

// Contraseña NUEVA: mínimo 8 caracteres y máximo 72 bytes.
function reglaPasswordNueva(campo = 'password') {
  return body(campo)
    .isString().withMessage('La contraseña es obligatoria')
    .bail()
    .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres')
    .bail()
    .custom(valor => Buffer.byteLength(valor, 'utf8') <= MAX_BYTES_PASSWORD)
    .withMessage('La contraseña es demasiado larga (máximo 72 bytes)');
}

// Abre la sesión del usuario. regenerate() crea un id de sesión
// NUEVO: si alguien le hubiera plantado un id conocido al navegador
// antes de entrar (fijación de sesión), deja de servirle. También se
// usa al cambiar la contraseña, para renovar el id de la sesión actual.
function abrirSesion(req, res, usuario, estadoHttp, extra = {}) {
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

      res.status(estadoHttp).json({ usuario: { id: usuario.id, nombre_usuario: usuario.nombre_usuario }, ...extra });
    });
  });
}

module.exports = {
  COSTO_BCRYPT,
  MAX_BYTES_PASSWORD,
  POSTGRES_UNIQUE_VIOLATION,
  manejarErroresValidacion,
  reglaNombreUsuario,
  reglaPasswordNueva,
  abrirSesion,
};
