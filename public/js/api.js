// ============================================================
// public/js/api.js
// Funciones delgadas sobre fetch() para hablar con la API de
// StudyFlow. Todas regresan una Promise que resuelve con el JSON
// de la respuesta, o rechaza con un Error. Si el servidor mando
// errores de validacion (express-validator), quedan en
// error.detalle como arreglo [{ campo, mensaje }] para poder
// mostrarlos campo por campo en el formulario.
// ============================================================

// "tipoArchivo": solo para subir un archivo (Blob); si viene, el cuerpo se manda
// tal cual con ese Content-Type en vez de como JSON.
async function peticion(metodo, url, cuerpo, tipoArchivo) {
  const opciones = { method: metodo, headers: {} };

  if (cuerpo !== undefined && tipoArchivo) {
    opciones.headers['Content-Type'] = tipoArchivo;
    opciones.body = cuerpo;
  } else if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  const respuesta = await fetch(url, opciones);
  // Algunas respuestas (ej. 204) no traen body; .json() tronaria.
  const datos = await respuesta.json().catch(() => ({}));

  // 401 en cualquier ruta de DATOS = la sesión venció mientras la
  // página seguía abierta: se vuelve a la pantalla de login. Las
  // rutas /api/auth/ quedan fuera a propósito: ahí un 401 es
  // "usuario o contraseña incorrectos" y se muestra en el formulario.
  if (respuesta.status === 401 && !url.startsWith('/api/auth/')) {
    manejarSesionExpirada();
  }

  if (!respuesta.ok) {
    const error = new Error(datos.error || `Error ${respuesta.status}`);
    error.detalle = datos.detalle;
    throw error;
  }

  return datos;
}

const api = {
  auth: {
    registro: (datos) => peticion('POST', '/api/auth/registro', datos),
    login: (datos) => peticion('POST', '/api/auth/login', datos),
    logout: () => peticion('POST', '/api/auth/logout'),
    yo: () => peticion('GET', '/api/auth/me'),
  },
  entregables: {
    listar: () => peticion('GET', '/api/entregables'),
    crear: (datos) => peticion('POST', '/api/entregables', datos),
    actualizar: (id, datos) => peticion('PUT', `/api/entregables/${id}`, datos),
    eliminar: (id) => peticion('DELETE', `/api/entregables/${id}`),
  },
  horarios: {
    listar: () => peticion('GET', '/api/horarios-fijos'),
    crear: (datos) => peticion('POST', '/api/horarios-fijos', datos),
    actualizar: (id, datos) => peticion('PUT', `/api/horarios-fijos/${id}`, datos),
    eliminar: (id) => peticion('DELETE', `/api/horarios-fijos/${id}`),
  },
  perfil: {
    obtener: () => peticion('GET', '/api/perfil'),
    actualizar: (datos) => peticion('PUT', '/api/perfil', datos),
    quitarFoto: () => peticion('DELETE', '/api/perfil/foto'),
    cambiarUsuario: (datos) => peticion('PUT', '/api/perfil/usuario', datos),
    cambiarPassword: (datos) => peticion('PUT', '/api/perfil/password', datos),
    eliminarCuenta: (datos) => peticion('DELETE', '/api/perfil/cuenta', datos),
    // La foto viaja como archivo (no JSON): el cuerpo es la imagen tal cual.
    subirFoto: (imagen) => peticion('PUT', '/api/perfil/foto', imagen, imagen.type),
  },
  plan: {
    generar: () => peticion('POST', '/api/plan/generar'),
    obtener: () => peticion('GET', '/api/plan'),
  },
  configuracion: {
    obtener: () => peticion('GET', '/api/configuracion'),
    actualizar: (datos) => peticion('PUT', '/api/configuracion', datos),
  },
};
