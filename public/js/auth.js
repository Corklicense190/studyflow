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

let modoRegistro = false;

function mostrarVistaAuth() {
  document.getElementById('vista-auth').classList.remove('hidden');
  document.getElementById('vista-app').classList.add('hidden');
  document.getElementById('usuario-area').classList.add('hidden');

  // Aviso "tu sesión expiró", si venimos de una expiración.
  try {
    if (sessionStorage.getItem(CLAVE_SESION_EXPIRADA)) {
      sessionStorage.removeItem(CLAVE_SESION_EXPIRADA);
      const aviso = document.getElementById('auth-aviso');
      aviso.textContent = 'Tu sesión expiró. Inicia sesión de nuevo.';
      aviso.classList.remove('hidden');
    }
  } catch { /* sin sessionStorage: solo no se muestra el aviso */ }
}

function mostrarVistaApp(usuario) {
  document.getElementById('vista-auth').classList.add('hidden');
  document.getElementById('vista-app').classList.remove('hidden');
  document.getElementById('usuario-area').classList.remove('hidden');
  // textContent (no innerHTML): el nombre se muestra como texto, jamás como HTML.
  document.getElementById('usuario-nombre').textContent = usuario.nombre_usuario;
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
    window.location.reload();
  } catch (error) {
    mostrarErroresFormulario('auth-error', error);
    // La contraseña no se deja escrita en pantalla después de un fallo.
    document.getElementById('auth-password').value = '';
    document.getElementById('auth-confirmar').value = '';
  }
}

async function manejarLogout() {
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
