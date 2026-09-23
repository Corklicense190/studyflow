// ============================================================
// public/js/api.js
// Funciones delgadas sobre fetch() para hablar con la API de
// StudyFlow. Todas regresan una Promise que resuelve con el JSON
// de la respuesta, o rechaza con un Error. Si el servidor mando
// errores de validacion (express-validator), quedan en
// error.detalle como arreglo [{ campo, mensaje }] para poder
// mostrarlos campo por campo en el formulario.
// ============================================================

async function peticion(metodo, url, cuerpo) {
  const opciones = { method: metodo, headers: {} };

  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  const respuesta = await fetch(url, opciones);
  // Algunas respuestas (ej. 204) no traen body; .json() tronaria.
  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const error = new Error(datos.error || `Error ${respuesta.status}`);
    error.detalle = datos.detalle;
    throw error;
  }

  return datos;
}

const api = {
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
  plan: {
    generar: () => peticion('POST', '/api/plan/generar'),
    obtener: () => peticion('GET', '/api/plan'),
  },
  configuracion: {
    obtener: () => peticion('GET', '/api/configuracion'),
    actualizar: (datos) => peticion('PUT', '/api/configuracion', datos),
  },
};
