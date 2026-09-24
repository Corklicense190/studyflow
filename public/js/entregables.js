// ============================================================
// public/js/entregables.js
// Pestaña "Entregables": listar, crear, editar y borrar.
// El mismo formulario sirve para crear Y editar (si
// #entregable-id trae un valor, es edición).
// ============================================================

let entregablesCache = [];

const NOTAS_MAX = 500;

// Contador "120/500" bajo el cuadro de notas.
function actualizarContadorNotas() {
  const largo = document.getElementById('entregable-notas').value.length;
  document.getElementById('entregable-notas-contador').textContent = `${largo}/${NOTAS_MAX}`;
}

const TIPO_ETIQUETA = { examen: 'Examen', evidencia: 'Evidencia', tarea: 'Tarea' };

// Mismos tipos que TIPOS_CON_DIFICULTAD_AUTOMATICA en
// routes/entregables.js — ahí es donde de verdad se fuerza el
// valor; aquí solo se refleja en la interfaz para no preguntar
// algo que el servidor va a ignorar de todas formas.
const TIPOS_CON_DIFICULTAD_AUTOMATICA = ['examen', 'evidencia'];

// Muestra el campo de dificultad solo para "tarea"; para
// examen/evidencia enseña la notita de "automático: 5" en su lugar.
function actualizarVisibilidadDificultad() {
  const tipo = document.getElementById('entregable-tipo').value;
  const esAutomatica = TIPOS_CON_DIFICULTAD_AUTOMATICA.includes(tipo);

  document.getElementById('entregable-dificultad-campo').classList.toggle('hidden', esAutomatica);
  document.getElementById('entregable-dificultad-nota').classList.toggle('hidden', !esAutomatica);
}

// La BD guarda fecha_limite como ISO completo ("2026-03-05T00:00:00.000Z").
// Para mostrar solo nos importan los primeros 10 caracteres.
function formatearFechaLegible(fechaISO) {
  const [anio, mes, dia] = fechaISO.slice(0, 10).split('-');
  return `${dia}/${mes}/${anio}`;
}

async function cargarEntregables() {
  try {
    entregablesCache = await api.entregables.listar();
    renderizarEntregables();
  } catch (error) {
    mostrarToast('error', `No se pudo cargar la lista de entregables: ${error.message}`);
  }
}

function renderizarEntregables() {
  const tbody = document.getElementById('entregables-lista');
  const vacio = document.getElementById('entregables-vacio');

  if (entregablesCache.length === 0) {
    tbody.innerHTML = '';
    vacio.classList.remove('hidden');
    return;
  }
  vacio.classList.add('hidden');

  // "materia" ya viene escapada por el servidor (express-validator
  // .escape() al guardarla en routes/entregables.js) — insertarla
  // via innerHTML es seguro: el navegador decodifica las entidades
  // y las muestra como texto plano, nunca las ejecuta como HTML.
  tbody.innerHTML = entregablesCache.map(e => `
    <tr>
      <td class="px-4 py-2">${e.materia}${e.notas ? `<div class="nota-previa">${e.notas}</div>` : ''}</td>
      <td class="px-4 py-2"><span class="punto-tipo tipo-${TIPO_ETIQUETA[e.tipo] ? e.tipo : 'tarea'}"></span>${TIPO_ETIQUETA[e.tipo] || e.tipo}</td>
      <td class="px-4 py-2">${formatearFechaLegible(e.fecha_limite)}</td>
      <td class="px-4 py-2">${e.dificultad}</td>
      <td class="px-4 py-2">${e.duracion_estimada}h</td>
      <td class="px-4 py-2 text-right space-x-3 whitespace-nowrap">
        <button type="button" class="text-blue-600 hover:underline text-xs" data-accion="editar" data-id="${e.id}">Editar</button>
        <button type="button" class="text-red-600 hover:underline text-xs" data-accion="borrar" data-id="${e.id}">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

function llenarFormularioEntregable(entregable) {
  document.getElementById('entregable-id').value = entregable.id;
  document.getElementById('entregable-materia').value = entregable.materia;
  document.getElementById('entregable-tipo').value = entregable.tipo;
  document.getElementById('entregable-fecha').value = entregable.fecha_limite.slice(0, 10);
  document.getElementById('entregable-dificultad').value = entregable.dificultad;
  document.getElementById('entregable-duracion').value = entregable.duracion_estimada;
  // "notas" ya viene escapada por el servidor; en un textarea se ve como texto plano
  // y se decodifica para poder editarla.
  document.getElementById('entregable-notas').value = decodificarEntidades(entregable.notas || '');
  actualizarContadorNotas();
  actualizarVisibilidadDificultad();

  document.getElementById('entregables-form-titulo').textContent = 'Editar entregable';
  document.getElementById('entregable-submit').textContent = 'Guardar cambios';
  document.getElementById('entregable-cancelar-edicion').classList.remove('hidden');
}

function limpiarFormularioEntregable() {
  document.getElementById('form-entregable').reset();
  document.getElementById('entregable-id').value = '';
  document.getElementById('entregables-form-titulo').textContent = 'Nuevo entregable';
  document.getElementById('entregable-submit').textContent = 'Agregar';
  document.getElementById('entregable-cancelar-edicion').classList.add('hidden');
  limpiarErroresFormulario('entregables-form-error');
  actualizarContadorNotas();
  actualizarVisibilidadDificultad();
}

async function manejarSubmitEntregable(evento) {
  evento.preventDefault();
  limpiarErroresFormulario('entregables-form-error');

  const id = document.getElementById('entregable-id').value;
  const tipo = document.getElementById('entregable-tipo').value;

  const datos = {
    materia: document.getElementById('entregable-materia').value,
    tipo,
    fecha_limite: document.getElementById('entregable-fecha').value,
    duracion_estimada: Number(document.getElementById('entregable-duracion').value),
    notas: document.getElementById('entregable-notas').value,
  };

  // Solo se manda dificultad cuando de verdad la elige el usuario
  // ("tarea"). Para examen/evidencia el servidor la fuerza a 5 sin
  // importar qué se mande, así que ni se molesta en enviarla.
  if (!TIPOS_CON_DIFICULTAD_AUTOMATICA.includes(tipo)) {
    datos.dificultad = Number(document.getElementById('entregable-dificultad').value);
  }

  try {
    if (id) {
      await api.entregables.actualizar(id, datos);
      mostrarToast('exito', 'Entregable actualizado correctamente');
    } else {
      await api.entregables.crear(datos);
      mostrarToast('exito', 'Entregable agregado correctamente');
    }
    limpiarFormularioEntregable();
    await cargarEntregables();
  } catch (error) {
    mostrarErroresFormulario('entregables-form-error', error);
  }
}

function manejarClicListaEntregables(evento) {
  const boton = evento.target.closest('button[data-accion]');
  if (!boton) return;

  const id = boton.dataset.id;
  const entregable = entregablesCache.find(e => String(e.id) === id);
  if (!entregable) return;

  if (boton.dataset.accion === 'editar') {
    llenarFormularioEntregable(entregable);
    document.getElementById('form-entregable').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (boton.dataset.accion === 'borrar') {
    abrirModalConfirmacion({
      titulo: 'Eliminar entregable',
      mensaje: `¿Seguro que quieres eliminar "${entregable.materia}"? También se borrarán sus bloques de estudio ya asignados. Esta acción no se puede deshacer.`,
      textoConfirmar: 'Eliminar',
      onConfirmar: async () => {
        try {
          await api.entregables.eliminar(id);
          mostrarToast('exito', 'Entregable eliminado');
          await cargarEntregables();
        } catch (error) {
          mostrarToast('error', error.message);
        }
      },
    });
  }
}

function inicializarEntregables() {
  document.getElementById('form-entregable').addEventListener('submit', manejarSubmitEntregable);
  document.getElementById('entregable-cancelar-edicion').addEventListener('click', limpiarFormularioEntregable);
  document.getElementById('entregables-lista').addEventListener('click', manejarClicListaEntregables);
  document.getElementById('entregable-tipo').addEventListener('change', actualizarVisibilidadDificultad);
  document.getElementById('entregable-notas').addEventListener('input', actualizarContadorNotas);
  actualizarVisibilidadDificultad(); // estado inicial acorde al tipo por defecto
  cargarEntregables();
}
