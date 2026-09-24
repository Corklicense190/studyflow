// ============================================================
// public/js/app.js
// Arranque de la app: cambio de pestañas y wiring de cosas
// globales (cerrar el modal con Cancelar/fondo/Escape). Los
// datos de cada pestaña los maneja su propio archivo
// (entregables.js, horarios.js, plan.js); aquí solo se
// inicializan una vez que el DOM está listo.
// ============================================================

// Título y explicación que se muestran arriba de cada sección.
const TITULOS_PAGINA = new Map([
  ['entregables', ['Entregables', 'Tus exámenes, evidencias y tareas con su fecha límite.']],
  ['horarios', ['Horarios fijos', 'Tus clases y compromisos: el plan nunca los pisa.']],
  ['plan', ['Plan de estudio', 'Cuándo estudiar cada cosa. Toca un bloque para ver qué estudiar.']],
  ['perfil', ['Mi perfil', 'Tu foto, tus datos y la seguridad de tu cuenta.']],
]);

function cambiarTab(nombre) {
  const [titulo, subtitulo] = TITULOS_PAGINA.get(nombre) || TITULOS_PAGINA.get('entregables');
  document.getElementById('pagina-titulo').textContent = titulo;
  document.getElementById('pagina-subtitulo').textContent = subtitulo;

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
    if (evento.key === 'Escape') {
      cerrarModalConfirmacion();
      cerrarModalBloque();
      cerrarModalCuenta();
    }
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

  // Sesión ligada a la pestaña (ver public/js/auth.js): tras recargar, o en una
  // pestaña que no inició sesión, se cierra y se pide la contraseña otra vez.
  if (debeCerrarSesionAlCargar()) {
    try { sessionStorage.setItem(CLAVE_AVISO_AUTH, 'Por seguridad, tu sesión se cierra al recargar o cerrar la página. Inicia sesión de nuevo.'); } catch { /* sin aviso */ }
    try { await api.auth.logout(); } catch { /* si falla, igual se muestra el login */ }
    mostrarVistaAuth();
    return;
  }

  mostrarVistaApp(usuario);
  activarCierreAlSalir();
  inicializarColores();
  inicializarEntregables();
  inicializarHorarios();
  inicializarPlan();
  inicializarPerfil();
});
