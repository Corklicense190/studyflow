// ============================================================
// public/js/app.js
// Arranque de la app: cambio de pestañas y wiring de cosas
// globales (cerrar el modal con Cancelar/fondo/Escape). Los
// datos de cada pestaña los maneja su propio archivo
// (entregables.js, horarios.js, plan.js); aquí solo se
// inicializan una vez que el DOM está listo.
// ============================================================

function cambiarTab(nombre) {
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `tab-${nombre}`);
  });

  document.querySelectorAll('.tab-boton').forEach(boton => {
    const activo = boton.dataset.tab === nombre;
    boton.classList.toggle('tab-boton-activo', activo);
    boton.setAttribute('aria-selected', activo ? 'true' : 'false');
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.tab-boton').forEach(boton => {
    boton.addEventListener('click', () => cambiarTab(boton.dataset.tab));
  });
  cambiarTab('entregables'); // pestaña inicial

  document.getElementById('modal-cancelar').addEventListener('click', cerrarModalConfirmacion);
  document.getElementById('modal-confirmacion').addEventListener('click', (evento) => {
    // Solo cierra si el clic fue en el fondo oscuro, no en la tarjeta.
    if (evento.target.id === 'modal-confirmacion') cerrarModalConfirmacion();
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') cerrarModalConfirmacion();
  });

  inicializarAuth();

  // Los datos (entregables, horarios, plan) solo se piden si hay
  // sesión. Sin ella no se hace ninguna petición a la API de datos:
  // se muestra la pantalla de login y listo.
  let usuario;
  try {
    ({ usuario } = await api.auth.yo());
  } catch {
    mostrarVistaAuth();
    return;
  }

  mostrarVistaApp(usuario);
  inicializarColores();
  inicializarEntregables();
  inicializarHorarios();
  inicializarPlan();
});
