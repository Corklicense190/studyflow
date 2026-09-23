// ============================================================
// public/js/ui.js
// Utilidades de interfaz compartidas entre las 3 secciones:
// toasts de exito/error, mensajes de validacion en formularios,
// y el modal de confirmacion antes de borrar (pedido por la
// rubrica de "facilidad de uso").
// ============================================================

// ── Toasts (mensajes flotantes temporales) ────────────────────
function mostrarToast(tipo, texto) {
  const contenedor = document.getElementById('toast-container');

  const colores = {
    exito: 'bg-green-600',
    error: 'bg-red-600',
    aviso: 'bg-amber-500',
  };

  const toast = document.createElement('div');
  // "tipo" siempre viene de un string literal fijo dentro del
  // propio código (nunca de entrada de usuario/API), así que el
  // acceso dinámico aquí no es un vector de inyección real.
  // eslint-disable-next-line security/detect-object-injection
  toast.className = `${colores[tipo] || colores.exito} text-white text-sm rounded-md shadow-lg px-4 py-3 max-w-sm`;
  toast.textContent = texto;
  contenedor.appendChild(toast);

  setTimeout(() => toast.remove(), 5000);
}

// ── Errores de validacion dentro de un formulario ─────────────
// "error" es el Error que lanza api.js. Si trae detalle (arreglo
// de express-validator), se listan uno por uno; si no, se muestra
// error.message tal cual (ej. errores 500 o "no existe el id X").
function mostrarErroresFormulario(contenedorId, error) {
  const contenedor = document.getElementById(contenedorId);

  if (Array.isArray(error.detalle) && error.detalle.length > 0) {
    contenedor.innerHTML = '<ul class="list-disc list-inside space-y-0.5">' +
      error.detalle.map(d => `<li>${d.mensaje}</li>`).join('') +
      '</ul>';
  } else {
    contenedor.textContent = error.message;
  }

  contenedor.classList.remove('hidden');
}

function limpiarErroresFormulario(contenedorId) {
  const contenedor = document.getElementById(contenedorId);
  contenedor.classList.add('hidden');
  contenedor.innerHTML = '';
}

// ── Modal de confirmacion ──────────────────────────────────────
// Un solo modal compartido por toda la app (definido una vez en
// index.html); cada llamado lo reconfigura con el texto y la
// accion que corresponda.
function abrirModalConfirmacion({ titulo, mensaje, textoConfirmar = 'Eliminar', onConfirmar }) {
  const modal = document.getElementById('modal-confirmacion');
  document.getElementById('modal-titulo').textContent = titulo;
  document.getElementById('modal-mensaje').textContent = mensaje;

  const btnConfirmarViejo = document.getElementById('modal-confirmar');
  btnConfirmarViejo.textContent = textoConfirmar;

  // Reemplazamos el boton por un clon limpio: si no hicieramos
  // esto, cada vez que se abre el modal se sumaria OTRO listener
  // de "click" encima de los anteriores, y una sola confirmacion
  // terminaria disparando la accion varias veces.
  const btnConfirmar = btnConfirmarViejo.cloneNode(true);
  btnConfirmarViejo.replaceWith(btnConfirmar);

  btnConfirmar.addEventListener('click', () => {
    cerrarModalConfirmacion();
    onConfirmar();
  });

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function cerrarModalConfirmacion() {
  const modal = document.getElementById('modal-confirmacion');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}
