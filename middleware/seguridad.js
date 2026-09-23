// ============================================================
// middleware/seguridad.js
// Dos middlewares chicos que protegen la API:
//   - requerirSesion: rechaza con 401 a quien no haya iniciado sesión.
//   - verificarOrigen: defensa en profundidad contra CSRF.
// ============================================================

// Se pone delante de cada router que maneja datos del usuario.
// Si pasa, las rutas pueden confiar en req.session.usuarioId.
function requerirSesion(req, res, next) {
  if (!req.session || !req.session.usuarioId) {
    return res.status(401).json({ error: 'Necesitas iniciar sesión' });
  }
  next();
}

// CSRF (que otro sitio haga peticiones a esta API usando tu cookie):
// la primera barrera es la cookie con SameSite=Strict, que el
// navegador no manda en peticiones que vienen de otros sitios. Esta
// es la segunda: en cualquier petición que modifica datos, si el
// navegador manda el header Origin, tiene que ser este mismo sitio.
// (Las peticiones sin Origin, como curl o pruebas, no son CSRF de
// navegador y se dejan pasar; siguen necesitando la cookie de sesión.)
function verificarOrigen(req, res, next) {
  const metodosQueModifican = ['POST', 'PUT', 'PATCH', 'DELETE'];

  if (metodosQueModifican.includes(req.method)) {
    const origen = req.get('origin');

    if (origen) {
      let hostOrigen;
      try {
        hostOrigen = new URL(origen).host;
      } catch {
        return res.status(403).json({ error: 'Origen no permitido' });
      }

      if (hostOrigen !== req.get('host')) {
        return res.status(403).json({ error: 'Origen no permitido' });
      }
    }
  }

  next();
}

module.exports = { requerirSesion, verificarOrigen };
