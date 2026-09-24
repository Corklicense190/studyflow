// ============================================================
// public/js/auth.js
// Pantalla de iniciar sesión / crear cuenta, botón de cerrar
// sesión y qué hacer cuando la sesión expira.
//
// Después de entrar o salir se recarga la página en vez de
// intentar "limpiar" todo el estado en memoria: así es imposible
// que los datos de un usuario se queden en pantalla cuando entra
// otro, y el arranque queda en un solo camino (app.js).
// ============================================================

// Clave de sessionStorage para recordar, tras la recarga, que la
// sesión expiró (y avisarlo una sola vez en la pantalla de login).
const CLAVE_SESION_EXPIRADA = 'studyflow-sesion-expirada';

// Aviso genérico para la pantalla de login tras una recarga (ej. "tu cuenta
// fue eliminada"). Guarda el texto a mostrar.
const CLAVE_AVISO_AUTH = 'studyflow-aviso-auth';

// La sesión se ata a la PESTAÑA: recargar la página o cerrarla la cierra. Es
// más estricto que lo habitual, a propósito (pedido explícito). Se logra con:
//   1. Una cookie de sesión sin fecha de vencimiento (ver app.js del servidor).
//   2. Un aviso al servidor al salir de la página (pagehide + sendBeacon).
//   3. Estas dos marcas en sessionStorage, que sobreviven a recargar pero no a
//      abrir otra pestaña ni a cerrar el navegador, como respaldo por si el
//      aviso del punto 2 no llegara (un aviso al cerrar es "lo mejor posible").
const CLAVE_PESTANA = 'studyflow-pestana';                    // esta pestaña inició sesión
const CLAVE_RECARGA_INTENCIONAL = 'studyflow-recarga-intencional'; // la recarga la hizo la propia app

let modoRegistro = false;

// true cuando la persona pulsa "Cerrar sesión": en ese caso no hace falta el
// aviso de "por seguridad la sesión se cierra al recargar".
let cierreVoluntario = false;

// Se llama justo después de iniciar sesión / crear cuenta y antes de recargar la
// página: sin esta marca, ese reload cuenta como una recarga del usuario.
function marcarPestanaAutenticada() {
  try {
    sessionStorage.setItem(CLAVE_PESTANA, '1');
    sessionStorage.setItem(CLAVE_RECARGA_INTENCIONAL, '1');
  } catch { /* sin sessionStorage: se depende solo del aviso al salir */ }
}

// Al cargar con una sesión abierta en el servidor: ¿hay que cerrarla?
//   - Si el usuario recargó la página (F5): sí.
//   - Si esta pestaña no fue la que inició sesión (pestaña o ventana nueva,
//     navegador reabierto): sí, para entrar hay que escribir la contraseña.
function debeCerrarSesionAlCargar() {
  try {
    const intencional = sessionStorage.getItem(CLAVE_RECARGA_INTENCIONAL) === '1';
    sessionStorage.removeItem(CLAVE_RECARGA_INTENCIONAL);

    const navegacion = performance.getEntriesByType('navigation')[0];
    if (navegacion && navegacion.type === 'reload' && !intencional) return true;

    return sessionStorage.getItem(CLAVE_PESTANA) !== '1';
  } catch {
    // Sin sessionStorage no se puede saber: no se bloquea el uso de la app.
    return false;
  }
}

// Cerrar o recargar la pestaña avisa al servidor para que destruya la sesión.
// sendBeacon está hecho justo para esto: se envía aunque la página ya se esté
// cerrando (un fetch normal se cancelaría).
function activarCierreAlSalir() {
  window.addEventListener('pagehide', () => {
    navigator.sendBeacon('/api/auth/logout');

    // Si la página se está recargando, al volver se explica por qué pide la
    // contraseña. No pisa otro aviso ya puesto (ej. "cuenta eliminada"), y no
    // se pone si fue el propio botón "Cerrar sesión".
    try {
      if (!cierreVoluntario && !sessionStorage.getItem(CLAVE_AVISO_AUTH)) {
        sessionStorage.setItem(CLAVE_AVISO_AUTH, 'Por seguridad, tu sesión se cierra al recargar o cerrar la página. Inicia sesión de nuevo.');
      }
    } catch { /* sin sessionStorage: solo no se muestra el aviso */ }
  });

  // Si el navegador guardó la página en su caché de "atrás/adelante" y la
  // restaura, la sesión ya se cerró al salir: se recarga para mostrar el login.
  window.addEventListener('pageshow', (evento) => {
    if (evento.persisted) window.location.reload();
  });
}

function mostrarVistaAuth() {
  try { sessionStorage.removeItem(CLAVE_PESTANA); } catch { /* ver arriba */ }

  document.getElementById('vista-auth').classList.remove('hidden');
  document.getElementById('vista-app').classList.add('hidden');
  document.getElementById('usuario-area').classList.add('hidden');
  document.getElementById('nav-principal').classList.add('hidden');

  // Aviso "tu sesión expiró", si venimos de una expiración.
  try {
    if (sessionStorage.getItem(CLAVE_SESION_EXPIRADA)) {
      sessionStorage.removeItem(CLAVE_SESION_EXPIRADA);
      const aviso = document.getElementById('auth-aviso');
      aviso.textContent = 'Tu sesión expiró. Inicia sesión de nuevo.';
      aviso.classList.remove('hidden');
    }

    const avisoGenerico = sessionStorage.getItem(CLAVE_AVISO_AUTH);
    if (avisoGenerico) {
      sessionStorage.removeItem(CLAVE_AVISO_AUTH);
      const aviso = document.getElementById('auth-aviso');
      aviso.textContent = avisoGenerico;
      aviso.classList.remove('hidden');
    }
  } catch { /* sin sessionStorage: solo no se muestra el aviso */ }
}

function mostrarVistaApp(usuario) {
  document.getElementById('vista-auth').classList.add('hidden');
  document.getElementById('vista-app').classList.remove('hidden');
  document.getElementById('usuario-area').classList.remove('hidden');
  document.getElementById('nav-principal').classList.remove('hidden');
  // textContent (no innerHTML): el nombre se muestra como texto, jamás como HTML.
  document.getElementById('usuario-nombre').textContent = usuario.nombre_usuario;
  document.getElementById('usuario-letra').textContent = usuario.nombre_usuario.charAt(0).toUpperCase();
}

// api.js la llama cuando cualquier petición a los datos recibe 401
// (la sesión venció mientras la página seguía abierta).
function manejarSesionExpirada() {
  try { sessionStorage.setItem(CLAVE_SESION_EXPIRADA, '1'); } catch { /* ver arriba */ }
  window.location.reload();
}

// Cambia el mismo formulario entre "Iniciar sesión" y "Crear cuenta".
function actualizarModoAuth() {
  document.getElementById('auth-titulo').textContent = modoRegistro ? 'Crear cuenta' : 'Iniciar sesión';
  document.getElementById('auth-submit').textContent = modoRegistro ? 'Crear cuenta' : 'Entrar';
  document.getElementById('auth-alterna-texto').textContent = modoRegistro ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
  document.getElementById('auth-alternar').textContent = modoRegistro ? 'Iniciar sesión' : 'Crear cuenta';
  document.getElementById('auth-confirmar-grupo').classList.toggle('hidden', !modoRegistro);
  document.getElementById('auth-ayuda-password').classList.toggle('hidden', !modoRegistro);

  // Le dice al gestor de contraseñas del navegador si es una
  // contraseña nueva (sugerir una fuerte) o una existente (autocompletar).
  document.getElementById('auth-password').setAttribute('autocomplete', modoRegistro ? 'new-password' : 'current-password');

  limpiarErroresFormulario('auth-error');
}

async function manejarSubmitAuth(evento) {
  evento.preventDefault();
  limpiarErroresFormulario('auth-error');

  const nombre_usuario = document.getElementById('auth-usuario').value;
  const password = document.getElementById('auth-password').value;

  if (modoRegistro && password !== document.getElementById('auth-confirmar').value) {
    mostrarErroresFormulario('auth-error', new Error('Las contraseñas no coinciden'));
    return;
  }

  try {
    if (modoRegistro) {
      await api.auth.registro({ nombre_usuario, password });
    } else {
      await api.auth.login({ nombre_usuario, password });
    }
    marcarPestanaAutenticada();
    window.location.reload();
  } catch (error) {
    mostrarErroresFormulario('auth-error', error);
    // La contraseña no se deja escrita en pantalla después de un fallo.
    document.getElementById('auth-password').value = '';
    document.getElementById('auth-confirmar').value = '';
  }
}

async function manejarLogout() {
  cierreVoluntario = true;

  try {
    await api.auth.logout();
  } finally {
    window.location.reload();
  }
}

function inicializarAuth() {
  document.getElementById('form-auth').addEventListener('submit', manejarSubmitAuth);
  document.getElementById('auth-alternar').addEventListener('click', () => {
    modoRegistro = !modoRegistro;
    actualizarModoAuth();
  });
  document.getElementById('boton-logout').addEventListener('click', manejarLogout);
}
