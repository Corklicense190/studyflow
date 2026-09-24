// ============================================================
// public/js/perfil.js
// Pestaña "Mi perfil": foto, datos personales, y cambio de nombre
// de usuario y de contraseña.
//
// La foto se prepara AQUÍ, en el navegador: se recorta en cuadro y se
// reduce a 256x256 en formato JPEG (unos 20-40 KB). Así lo que sube es
// pequeño, y al volver a dibujarla se descartan datos ocultos de la
// imagen original (ubicación GPS, etc.). El servidor vuelve a
// comprobar tipo, firma y tamaño: esto es comodidad, no seguridad.
// ============================================================

const LADO_FOTO = 256;
const CALIDAD_FOTO = 0.85;
// Archivo original máximo que se intenta leer (antes de reducirlo).
const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
const SOBRE_MI_MAX = 300;

let perfilActual = null;

// Los textos del perfil los guarda el servidor ya escapados (< -> &lt;).
// Para mostrarlos con textContent hay que devolverlos a texto normal.
function textoDePerfil(valor) {
  return decodificarEntidades(valor || '');
}

function nombreParaMostrar(perfil) {
  return textoDePerfil(perfil.apodo) || perfil.nombre_usuario;
}

// Letra o foto en un avatar (el de la barra lateral y el grande del perfil).
function pintarAvatar(idLetra, idFoto, perfil) {
  const letra = document.getElementById(idLetra);
  const foto = document.getElementById(idFoto);

  letra.textContent = nombreParaMostrar(perfil).charAt(0).toUpperCase();

  if (perfil.tiene_foto) {
    // ?v=<versión>: al subir una foto nueva la URL cambia y el navegador
    // no enseña la anterior guardada en caché.
    foto.src = `/api/perfil/foto?v=${encodeURIComponent(perfil.foto_version)}`;
    foto.classList.remove('hidden');
    letra.classList.add('hidden');
  } else {
    foto.removeAttribute('src');
    foto.classList.add('hidden');
    letra.classList.remove('hidden');
  }
}

function formatearMiembroDesde(creadoEn) {
  const fecha = new Date(creadoEn);
  if (Number.isNaN(fecha.getTime())) return '';
  return `Miembro desde ${fecha.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`;
}

function actualizarContadorSobreMi() {
  const largo = document.getElementById('perfil-sobre-mi').value.length;
  document.getElementById('perfil-sobre-mi-contador').textContent = `${largo}/${SOBRE_MI_MAX}`;
}

// Pinta todo lo que depende del perfil: encabezado, avatares y, si
// "rellenar", también los campos del formulario.
function mostrarPerfil(perfil, rellenar) {
  perfilActual = perfil;

  document.getElementById('usuario-nombre').textContent = nombreParaMostrar(perfil);
  pintarAvatar('usuario-letra', 'usuario-foto', perfil);
  pintarAvatar('perfil-letra', 'perfil-foto', perfil);

  document.getElementById('perfil-nombre').textContent = nombreParaMostrar(perfil);
  document.getElementById('perfil-usuario').textContent = `@${perfil.nombre_usuario} · ${formatearMiembroDesde(perfil.creado_en)}`;

  const resumen = [textoDePerfil(perfil.institucion), textoDePerfil(perfil.carrera)].filter(Boolean).join(' · ');
  const sobreMi = textoDePerfil(perfil.sobre_mi);
  document.getElementById('perfil-resumen').textContent = [resumen, sobreMi].filter(Boolean).join(' — ');

  document.getElementById('perfil-foto-quitar').classList.toggle('hidden', !perfil.tiene_foto);

  if (rellenar) {
    document.getElementById('perfil-apodo').value = textoDePerfil(perfil.apodo);
    document.getElementById('perfil-institucion').value = textoDePerfil(perfil.institucion);
    document.getElementById('perfil-carrera').value = textoDePerfil(perfil.carrera);
    document.getElementById('perfil-sobre-mi').value = textoDePerfil(perfil.sobre_mi);
    actualizarContadorSobreMi();
  }
}

async function cargarPerfil() {
  try {
    mostrarPerfil(await api.perfil.obtener(), true);
  } catch (error) {
    mostrarToast('error', `No se pudo cargar tu perfil: ${error.message}`);
  }
}

// ── Datos personales ─────────────────────────────────────────
async function manejarSubmitDatos(evento) {
  evento.preventDefault();
  limpiarErroresFormulario('perfil-datos-error');

  const datos = {
    apodo: document.getElementById('perfil-apodo').value,
    institucion: document.getElementById('perfil-institucion').value,
    carrera: document.getElementById('perfil-carrera').value,
    sobre_mi: document.getElementById('perfil-sobre-mi').value,
  };

  try {
    await api.perfil.actualizar(datos);
    mostrarToast('exito', 'Perfil guardado');
    await cargarPerfil();
  } catch (error) {
    mostrarErroresFormulario('perfil-datos-error', error);
  }
}

// ── Foto ─────────────────────────────────────────────────────
// Recorta al centro en cuadro, reduce y devuelve un Blob JPEG.
async function prepararFoto(archivo) {
  // createImageBitmap lee la imagen sin crear una URL temporal (el CSP de
  // la app no permite imágenes blob:).
  const imagen = await createImageBitmap(archivo);

  const lado = Math.min(imagen.width, imagen.height);
  const origenX = (imagen.width - lado) / 2;
  const origenY = (imagen.height - lado) / 2;

  const lienzo = document.createElement('canvas');
  lienzo.width = LADO_FOTO;
  lienzo.height = LADO_FOTO;
  const contexto = lienzo.getContext('2d');

  // Fondo blanco: un PNG con transparencia no se vería negro en el JPEG.
  contexto.fillStyle = '#ffffff';
  contexto.fillRect(0, 0, LADO_FOTO, LADO_FOTO);
  contexto.drawImage(imagen, origenX, origenY, lado, lado, 0, 0, LADO_FOTO, LADO_FOTO);
  imagen.close();

  return new Promise((resolver, rechazar) => {
    lienzo.toBlob(
      blob => (blob ? resolver(blob) : rechazar(new Error('No se pudo preparar la imagen'))),
      'image/jpeg',
      CALIDAD_FOTO
    );
  });
}

async function manejarArchivoFoto(evento) {
  const archivo = evento.target.files[0];
  evento.target.value = ''; // permite volver a elegir el mismo archivo
  if (!archivo) return;

  if (!archivo.type.startsWith('image/')) {
    mostrarToast('error', 'Elige un archivo de imagen (JPG, PNG o WebP).');
    return;
  }

  if (archivo.size > MAX_ORIGINAL_BYTES) {
    mostrarToast('error', 'La imagen es demasiado grande (máximo 15 MB).');
    return;
  }

  const boton = document.getElementById('perfil-foto-cambiar');
  boton.disabled = true;
  boton.textContent = 'Subiendo…';

  try {
    let blob;
    try {
      blob = await prepararFoto(archivo);
    } catch {
      throw new Error('No se pudo leer esa imagen. Prueba con otra.');
    }

    await api.perfil.subirFoto(blob);
    mostrarToast('exito', 'Foto actualizada');
    await cargarPerfil();
  } catch (error) {
    mostrarToast('error', error.message);
  } finally {
    boton.disabled = false;
    boton.textContent = 'Cambiar foto';
  }
}

function manejarQuitarFoto() {
  abrirModalConfirmacion({
    titulo: 'Quitar foto de perfil',
    mensaje: '¿Seguro que quieres quitar tu foto? Volverás a ver tu inicial.',
    textoConfirmar: 'Quitar',
    onConfirmar: async () => {
      try {
        await api.perfil.quitarFoto();
        mostrarToast('exito', 'Foto eliminada');
        await cargarPerfil();
      } catch (error) {
        mostrarToast('error', error.message);
      }
    },
  });
}

// ── Cuenta: usuario y contraseña ─────────────────────────────
async function manejarSubmitUsuario(evento) {
  evento.preventDefault();
  limpiarErroresFormulario('perfil-usuario-error');

  const datos = {
    nombre_usuario: document.getElementById('perfil-nuevo-usuario').value,
    password_actual: document.getElementById('perfil-usuario-password').value,
  };

  try {
    const resultado = await api.perfil.cambiarUsuario(datos);
    document.getElementById('form-perfil-usuario').reset();
    mostrarToast('exito', resultado.mensaje);
    await cargarPerfil();
  } catch (error) {
    mostrarErroresFormulario('perfil-usuario-error', error);
  }
}

async function manejarSubmitPassword(evento) {
  evento.preventDefault();
  limpiarErroresFormulario('perfil-password-error');

  const nueva = document.getElementById('perfil-password-nueva').value;

  if (nueva !== document.getElementById('perfil-password-confirmar').value) {
    mostrarErroresFormulario('perfil-password-error', new Error('Las contraseñas nuevas no coinciden.'));
    return;
  }

  try {
    const resultado = await api.perfil.cambiarPassword({
      password_actual: document.getElementById('perfil-password-actual').value,
      password_nueva: nueva,
    });
    document.getElementById('form-perfil-password').reset();
    mostrarToast('exito', resultado.mensaje);
  } catch (error) {
    mostrarErroresFormulario('perfil-password-error', error);
  }
}

// ── Eliminar la cuenta ───────────────────────────────────────
function abrirModalCuenta() {
  document.getElementById('cuenta-usuario-esperado').textContent = perfilActual.nombre_usuario;
  document.getElementById('form-cuenta-eliminar').reset();
  limpiarErroresFormulario('cuenta-error');
  actualizarBotonEliminarCuenta();

  const modal = document.getElementById('modal-cuenta');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.getElementById('cuenta-confirmacion').focus();
}

function cerrarModalCuenta() {
  const modal = document.getElementById('modal-cuenta');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

// El botón rojo solo se activa cuando el nombre coincide y hay contraseña.
// Es solo comodidad: el servidor vuelve a comprobar las dos cosas.
function actualizarBotonEliminarCuenta() {
  const nombreCoincide = document.getElementById('cuenta-confirmacion').value === perfilActual.nombre_usuario;
  const hayPassword = document.getElementById('cuenta-password').value.length > 0;
  document.getElementById('cuenta-confirmar').disabled = !(nombreCoincide && hayPassword);
}

async function manejarEliminarCuenta(evento) {
  evento.preventDefault();
  limpiarErroresFormulario('cuenta-error');

  const boton = document.getElementById('cuenta-confirmar');
  boton.disabled = true;
  boton.textContent = 'Eliminando…';

  try {
    await api.perfil.eliminarCuenta({
      password_actual: document.getElementById('cuenta-password').value,
      confirmacion: document.getElementById('cuenta-confirmacion').value,
    });

    // Vuelve a la pantalla de inicio con un aviso.
    try { sessionStorage.setItem(CLAVE_AVISO_AUTH, 'Tu cuenta y todos tus datos fueron eliminados.'); } catch { /* sin aviso */ }
    window.location.reload();
  } catch (error) {
    mostrarErroresFormulario('cuenta-error', error);
    boton.textContent = 'Eliminar mi cuenta para siempre';
    actualizarBotonEliminarCuenta();
  }
}

function inicializarPerfil() {
  document.getElementById('cuenta-eliminar-abrir').addEventListener('click', abrirModalCuenta);
  document.getElementById('cuenta-cancelar').addEventListener('click', cerrarModalCuenta);
  document.getElementById('form-cuenta-eliminar').addEventListener('submit', manejarEliminarCuenta);
  document.getElementById('cuenta-confirmacion').addEventListener('input', actualizarBotonEliminarCuenta);
  document.getElementById('cuenta-password').addEventListener('input', actualizarBotonEliminarCuenta);
  document.getElementById('modal-cuenta').addEventListener('click', (evento) => {
    // Solo cierra si el clic fue en el fondo oscuro, no en la tarjeta.
    if (evento.target.id === 'modal-cuenta') cerrarModalCuenta();
  });

  document.getElementById('form-perfil-datos').addEventListener('submit', manejarSubmitDatos);
  document.getElementById('form-perfil-usuario').addEventListener('submit', manejarSubmitUsuario);
  document.getElementById('form-perfil-password').addEventListener('submit', manejarSubmitPassword);
  document.getElementById('perfil-sobre-mi').addEventListener('input', actualizarContadorSobreMi);

  document.getElementById('perfil-foto-cambiar').addEventListener('click', () => {
    document.getElementById('perfil-foto-archivo').click();
  });
  document.getElementById('perfil-foto-archivo').addEventListener('change', manejarArchivoFoto);
  document.getElementById('perfil-foto-quitar').addEventListener('click', manejarQuitarFoto);

  // Tocar tu avatar o tu nombre en la barra lateral abre el perfil.
  document.getElementById('usuario-perfil').addEventListener('click', () => cambiarTab('perfil'));

  cargarPerfil();
}
