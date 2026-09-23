// ============================================================
// public/js/horarios.js
// Pestaña "Horarios fijos": listar, crear, editar y borrar.
// Mismo patrón que entregables.js (un formulario para crear Y
// editar, modal de confirmación antes de borrar).
// ============================================================

let horariosCache = [];

const DIA_ETIQUETA = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves',
  viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo',
};

async function cargarHorarios() {
  try {
    horariosCache = await api.horarios.listar();
    renderizarHorarios();
  } catch (error) {
    mostrarToast('error', `No se pudo cargar los horarios fijos: ${error.message}`);
  }
}

function renderizarHorarios() {
  const tbody = document.getElementById('horarios-lista');
  const vacio = document.getElementById('horarios-vacio');

  if (horariosCache.length === 0) {
    tbody.innerHTML = '';
    vacio.classList.remove('hidden');
    return;
  }
  vacio.classList.add('hidden');

  // "descripcion" ya viene escapada por el servidor (misma razón
  // que "materia" en entregables.js) — segura para innerHTML.
  tbody.innerHTML = horariosCache.map(h => `
    <tr>
      <td class="px-4 py-2">${DIA_ETIQUETA[h.dia_semana] || h.dia_semana}</td>
      <td class="px-4 py-2">${h.hora_inicio} – ${h.hora_fin}</td>
      <td class="px-4 py-2 text-gray-500">${h.descripcion || '—'}</td>
      <td class="px-4 py-2 text-right space-x-3 whitespace-nowrap">
        <button type="button" class="text-blue-600 hover:underline text-xs" data-accion="editar" data-id="${h.id}">Editar</button>
        <button type="button" class="text-red-600 hover:underline text-xs" data-accion="borrar" data-id="${h.id}">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

function llenarFormularioHorario(horario) {
  document.getElementById('horario-id').value = horario.id;
  document.getElementById('horario-dia').value = horario.dia_semana;
  document.getElementById('horario-inicio').value = horario.hora_inicio;
  document.getElementById('horario-fin').value = horario.hora_fin;
  document.getElementById('horario-descripcion').value = horario.descripcion || '';

  document.getElementById('horario-form-titulo').textContent = 'Editar horario fijo';
  document.getElementById('horario-submit').textContent = 'Guardar cambios';
  document.getElementById('horario-cancelar-edicion').classList.remove('hidden');
}

function limpiarFormularioHorario() {
  document.getElementById('form-horario').reset();
  document.getElementById('horario-id').value = '';
  document.getElementById('horario-form-titulo').textContent = 'Nuevo horario fijo';
  document.getElementById('horario-submit').textContent = 'Agregar';
  document.getElementById('horario-cancelar-edicion').classList.add('hidden');
  limpiarErroresFormulario('horario-form-error');
}

async function manejarSubmitHorario(evento) {
  evento.preventDefault();
  limpiarErroresFormulario('horario-form-error');

  const id = document.getElementById('horario-id').value;
  const datos = {
    dia_semana: document.getElementById('horario-dia').value,
    hora_inicio: document.getElementById('horario-inicio').value,
    hora_fin: document.getElementById('horario-fin').value,
    descripcion: document.getElementById('horario-descripcion').value,
  };

  try {
    if (id) {
      await api.horarios.actualizar(id, datos);
      mostrarToast('exito', 'Horario actualizado correctamente');
    } else {
      await api.horarios.crear(datos);
      mostrarToast('exito', 'Horario agregado correctamente');
    }
    limpiarFormularioHorario();
    await cargarHorarios();
  } catch (error) {
    mostrarErroresFormulario('horario-form-error', error);
  }
}

function manejarClicListaHorarios(evento) {
  const boton = evento.target.closest('button[data-accion]');
  if (!boton) return;

  const id = boton.dataset.id;
  const horario = horariosCache.find(h => String(h.id) === id);
  if (!horario) return;

  if (boton.dataset.accion === 'editar') {
    llenarFormularioHorario(horario);
    document.getElementById('form-horario').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (boton.dataset.accion === 'borrar') {
    const etiquetaDia = DIA_ETIQUETA[horario.dia_semana] || horario.dia_semana;
    abrirModalConfirmacion({
      titulo: 'Eliminar horario fijo',
      mensaje: `¿Seguro que quieres eliminar el horario del ${etiquetaDia} de ${horario.hora_inicio} a ${horario.hora_fin}? Esta acción no se puede deshacer.`,
      textoConfirmar: 'Eliminar',
      onConfirmar: async () => {
        try {
          await api.horarios.eliminar(id);
          mostrarToast('exito', 'Horario eliminado');
          await cargarHorarios();
        } catch (error) {
          mostrarToast('error', error.message);
        }
      },
    });
  }
}

function inicializarHorarios() {
  document.getElementById('form-horario').addEventListener('submit', manejarSubmitHorario);
  document.getElementById('horario-cancelar-edicion').addEventListener('click', limpiarFormularioHorario);
  document.getElementById('horarios-lista').addEventListener('click', manejarClicListaHorarios);
  cargarHorarios();
}
