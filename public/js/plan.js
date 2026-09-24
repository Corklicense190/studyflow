// ============================================================
// public/js/plan.js
// Pestaña "Plan de estudio": botón para generar (recálculo
// total, ver routes/plan.js) y calendario visual con los
// bloques resultantes + las clases fijas como contexto.
//
// El calendario cubre exactamente el rango de fechas que trae
// el plan (desde el bloque más antiguo hasta el más reciente),
// no necesariamente una sola semana Lunes-Domingo — así sigue
// siendo útil aunque el plan abarque varias semanas.
// ============================================================

// horaAMinutosLocal replica lo que ya hace algoritmo/priorizar.js.
// Se duplica aquí en JS de navegador porque ese módulo usa
// module.exports (CommonJS) y no se puede cargar tal cual con un
// <script> normal sin un bundler — para 2 funciones tan chicas no
// vale la pena meter herramientas nuevas al proyecto.
function horaAMinutosLocal(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

// Más alto que antes (0.8): con la letra más grande cada bloque necesita
// más espacio para que el nombre y el rango de horas se lean completos.
const PX_POR_MINUTO = 1;

// La ventana horaria y el límite diario ya NO son fijos: se leen de
// /api/configuracion (tabla "configuracion", ajustable desde este
// mismo formulario). Estos valores por defecto solo se usan un
// instante antes de que cargarPlan() traiga los reales.
let configuracionActual = { limite_horas_dia: 4, ventana_inicio: '07:00', ventana_fin: '22:00' };

function ventanaInicioMin() { return horaAMinutosLocal(configuracionActual.ventana_inicio); }
function ventanaFinMin()    { return horaAMinutosLocal(configuracionActual.ventana_fin); }

// Primer minuto que dibuja el calendario. Normalmente es el inicio de la
// ventana de estudio, pero se adelanta si hay una clase fuera de ella (ver
// calcularRangoVisible). bloqueHtml lo usa para colocar cada bloque.
let inicioVisibleMin = 0;

// El calendario NO puede limitarse a la ventana de estudio: una clase fija a
// las 08:00 con la ventana desde las 10:00 quedaría dibujada fuera de la
// cuadrícula, encima del encabezado. Este rango incluye la ventana Y todo lo
// que se va a dibujar, redondeado a horas completas (para que las líneas
// de hora caigan justo en el borde). "tramos" es una lista de [inicio, fin] en
// minutos.
function calcularRangoVisible(inicioVentana, finVentana, tramos) {
  let inicio = inicioVentana;
  let fin = finVentana;

  for (const [desde, hasta] of tramos) {
    inicio = Math.min(inicio, desde);
    fin = Math.max(fin, hasta);
  }

  return { inicio: Math.floor(inicio / 60) * 60, fin: Math.ceil(fin / 60) * 60 };
}

const DIAS_SEMANA_LOCAL = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// El color de cada tipo lo elige el usuario (ver colores.js): estas clases
// usan variables CSS, no colores fijos.
const CLASE_POR_TIPO = {
  examen: 'tipo-examen',
  evidencia: 'tipo-evidencia',
  tarea: 'tipo-tarea',
};
const DIA_CORTO = { domingo: 'Dom', lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie', sabado: 'Sáb' };

// "fecha" es "YYYY-MM-DD". new Date() sobre un string SOLO fecha
// (sin hora) lo interpreta como medianoche UTC por especificación
// del lenguaje, así que usar getUTCDay() da el día correcto sin
// importar la zona horaria del navegador.
function diaDeLaSemanaLocal(fecha) {
  return DIAS_SEMANA_LOCAL[new Date(fecha).getUTCDay()];
}

function formatearEncabezadoDia(fecha) {
  const [, mes, dia] = fecha.split('-');
  return `${DIA_CORTO[diaDeLaSemanaLocal(fecha)]} ${dia}/${mes}`;
}

function generarRangoFechas(desde, hasta) {
  const dias = [];
  let cursor = new Date(desde);
  const fin = new Date(hasta);
  while (cursor.getTime() <= fin.getTime()) {
    dias.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dias;
}

let horariosParaCalendario = [];

// Bloques del plan tal como llegaron del servidor: el detalle que se abre al
// tocar un bloque los busca aquí por id (sin volver a pedir nada).
let bloquesActuales = [];

function llenarFormularioConfiguracion(config) {
  document.getElementById('config-limite').value = config.limite_horas_dia;
  document.getElementById('config-ventana-inicio').value = config.ventana_inicio;
  document.getElementById('config-ventana-fin').value = config.ventana_fin;
}

async function cargarPlan() {
  try {
    // La configuración se carga junto con el plan porque el
    // calendario necesita conocer la ventana horaria REAL antes de
    // dibujar la cuadrícula (si no, dibujaría siempre 07:00-22:00
    // sin importar lo que el usuario haya guardado).
    const [bloques, horarios, config] = await Promise.all([
      api.plan.obtener(),
      api.horarios.listar(),
      api.configuracion.obtener(),
    ]);
    horariosParaCalendario = horarios;
    configuracionActual = config;
    llenarFormularioConfiguracion(config);
    bloquesActuales = bloques;
    renderizarCalendario(bloques);
  } catch (error) {
    mostrarToast('error', `No se pudo cargar el plan: ${error.message}`);
  }
}

async function manejarSubmitConfiguracion(evento) {
  evento.preventDefault();
  limpiarErroresFormulario('configuracion-error');

  const datos = {
    limite_horas_dia: Number(document.getElementById('config-limite').value),
    ventana_inicio: document.getElementById('config-ventana-inicio').value,
    ventana_fin: document.getElementById('config-ventana-fin').value,
  };

  try {
    const resultado = await api.configuracion.actualizar(datos);
    configuracionActual = resultado.configuracion;
    mostrarToast('exito', 'Configuración guardada — se aplicará la próxima vez que generes el horario');
  } catch (error) {
    mostrarErroresFormulario('configuracion-error', error);
  }
}

// Un solo bloque posicionado dentro de su columna de día, usando
// top/height en px calculados a partir de la hora exacta. Muestra
// la etiqueta (materia o descripcion) arriba y el rango de horas
// pegado abajo a la derecha, pedido explícitamente para poder ver
// de un vistazo cuánto dura cada bloque sin tener que pasar el mouse.
// "etiqueta" ya viene escapada por el servidor — segura tanto en
// el contenido del div como en el atributo title.
function bloqueHtml(horaInicio, horaFin, etiqueta, clasesColor, bloqueId = null, tieneNota = false) {
  const inicioMin = horaAMinutosLocal(horaInicio);
  const finMin = horaAMinutosLocal(horaFin);
  const top = (inicioMin - inicioVisibleMin) * PX_POR_MINUTO;
  const alto = (finMin - inicioMin) * PX_POR_MINUTO;

  const claseCorto = finMin - inicioMin <= 30 ? ' calendario-bloque-corto' : '';

  // Iconito de "tiene nota" junto al nombre, para verlo de un vistazo.
  const marcaNota = tieneNota
    ? '<svg class="calendario-nota" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-label="Tiene nota"><path d="M4 5h16M4 12h16M4 19h10"/></svg>'
    : '';

  const contenido = `
      <span class="calendario-bloque-nombre">${etiqueta}${marcaNota}</span>
      <span class="calendario-bloque-horas">${horaInicio}-${horaFin}</span>`;
  const atributos = `class="calendario-bloque${claseCorto} ${clasesColor}" style="top:${top}px;height:${alto}px" title="${etiqueta} (${horaInicio}-${horaFin})"`;

  // Los bloques de estudio son botones (se pueden tocar y usar con teclado);
  // las clases fijas son solo contexto y siguen siendo un div.
  if (bloqueId !== null) {
    return `<button type="button" ${atributos} data-bloque-id="${Number(bloqueId)}">${contenido}</button>`;
  }
  return `<div ${atributos}>${contenido}</div>`;
}

function renderizarCalendario(bloques) {
  const vacio = document.getElementById('plan-vacio');
  const envoltura = document.getElementById('plan-calendario-envoltura');

  if (bloques.length === 0) {
    vacio.classList.remove('hidden');
    envoltura.classList.add('hidden');
    envoltura.innerHTML = '';
    return;
  }
  vacio.classList.add('hidden');
  envoltura.classList.remove('hidden');

  const fechas = bloques.map(b => b.fecha).sort();
  const dias = generarRangoFechas(fechas[0], fechas[fechas.length - 1]);
  // Rango que se dibuja: la ventana de estudio ampliada para que quepan las
  // clases fijas de los días mostrados y cualquier bloque de estudio.
  const diasMostrados = new Set(dias.map(diaDeLaSemanaLocal));
  const tramos = [
    ...horariosParaCalendario
      .filter(h => diasMostrados.has(h.dia_semana))
      .map(h => [horaAMinutosLocal(h.hora_inicio), horaAMinutosLocal(h.hora_fin)]),
    ...bloques.map(b => [horaAMinutosLocal(b.hora_inicio), horaAMinutosLocal(b.hora_fin)]),
  ];
  const rango = calcularRangoVisible(ventanaInicioMin(), ventanaFinMin(), tramos);
  const inicioMin = rango.inicio;
  const finMin = rango.fin;
  inicioVisibleMin = inicioMin;
  const alturaTotal = (finMin - inicioMin) * PX_POR_MINUTO;

  // Zonas fuera del horario de estudio (solo existen si el rango se amplió):
  // se pintan apagadas para que se entienda que ahí el plan no agenda nada.
  const alturaAntesVentana = (ventanaInicioMin() - inicioMin) * PX_POR_MINUTO;
  const topDespuesVentana = (ventanaFinMin() - inicioMin) * PX_POR_MINUTO;
  const alturaDespuesVentana = (finMin - ventanaFinMin()) * PX_POR_MINUTO;
  const hayZonaFuera = alturaAntesVentana > 0 || alturaDespuesVentana > 0;

  let html = `
    <div class="flex items-center gap-4 text-xs text-gray-600 mb-3">
      <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm tipo-examen"></span> Examen</span>
      <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm tipo-evidencia"></span> Evidencia</span>
      <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm tipo-tarea"></span> Tarea</span>
      <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-gray-300"></span> Clase</span>
      ${hayZonaFuera ? '<span class="flex items-center gap-1"><span class="muestra-fuera-ventana"></span> Fuera de tu horario de estudio</span>' : ''}
    </div>
    <div class="calendario-grid" style="--dias:${dias.length}">
  `;

  // Columna de etiquetas de hora (cada hora en punto, según la
  // ventana configurada — ya no es un rango fijo).
  html += `<div class="relative" style="height:${alturaTotal}px">`;
  for (let min = inicioMin; min <= finMin; min += 60) {
    const top = (min - inicioMin) * PX_POR_MINUTO;
    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    html += `<div class="absolute text-xs text-gray-500 -translate-y-1/2" style="top:${top}px">${hh}:00</div>`;
  }
  html += `</div>`;

  // Una columna por cada fecha del rango.
  for (const fecha of dias) {
    const diaSemana = diaDeLaSemanaLocal(fecha);
    const clasesDelDia = horariosParaCalendario.filter(h => h.dia_semana === diaSemana);
    const bloquesDelDia = bloques.filter(b => b.fecha === fecha);

    html += `<div>
      <div class="text-xs font-medium text-gray-700 text-center pb-1 border-b border-gray-200">${formatearEncabezadoDia(fecha)}</div>
      <div class="calendario-columna-dia" style="height:${alturaTotal}px">`;

    if (alturaAntesVentana > 0) {
      html += `<div class="calendario-fuera-ventana" style="top:0;height:${alturaAntesVentana}px"></div>`;
    }
    if (alturaDespuesVentana > 0) {
      html += `<div class="calendario-fuera-ventana" style="top:${topDespuesVentana}px;height:${alturaDespuesVentana}px"></div>`;
    }

    for (let min = inicioMin; min <= finMin; min += 60) {
      const top = (min - inicioMin) * PX_POR_MINUTO;
      html += `<div class="calendario-linea-hora" style="top:${top}px"></div>`;
    }

    // Clases fijas primero (gris, de contexto), luego los bloques
    // de estudio encima (colores según tipo de entregable).
    for (const clase of clasesDelDia) {
      html += bloqueHtml(clase.hora_inicio, clase.hora_fin, clase.descripcion || 'Clase', 'bg-gray-300 text-gray-700');
    }
    for (const bloque of bloquesDelDia) {
      const color = CLASE_POR_TIPO[bloque.tipo] || CLASE_POR_TIPO.tarea;
      html += bloqueHtml(bloque.hora_inicio, bloque.hora_fin, bloque.materia, color, bloque.id, Boolean(bloque.notas));
    }

    html += `</div></div>`;
  }

  html += `</div>`;
  envoltura.innerHTML = html;
}

// ── Detalle de un bloque (materia, sesión, fecha límite y nota) ──
let entregableDelDetalle = null;

function abrirModalBloque(bloque) {
  entregableDelDetalle = bloque.entregable_id;

  const chip = document.getElementById('bloque-tipo');
  chip.textContent = TIPO_ETIQUETA[bloque.tipo] || bloque.tipo;
  chip.className = `chip-tipo ${CLASE_POR_TIPO[bloque.tipo] || CLASE_POR_TIPO.tarea}`;

  // Todo va con textContent salvo el título y la nota, que el servidor ya
  // guarda escapados: se decodifican para mostrarlos como texto normal, nunca
  // como HTML.
  document.getElementById('bloque-titulo').textContent = decodificarEntidades(bloque.materia);
  document.getElementById('bloque-sesion').textContent =
    `${formatearEncabezadoDia(bloque.fecha)} · ${bloque.hora_inicio}-${bloque.hora_fin}`;
  document.getElementById('bloque-limite').textContent = formatearFechaLegible(bloque.fecha_limite);

  const notas = document.getElementById('bloque-notas');
  if (bloque.notas) {
    notas.textContent = decodificarEntidades(bloque.notas);
    notas.classList.remove('nota-vacia');
  } else {
    notas.textContent = 'Sin nota. Puedes agregar qué estudiar editando el entregable.';
    notas.classList.add('nota-vacia');
  }

  const modal = document.getElementById('modal-bloque');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.getElementById('bloque-cerrar').focus();
}

function cerrarModalBloque() {
  const modal = document.getElementById('modal-bloque');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

// Tocar un bloque de estudio abre su detalle.
function manejarClicCalendario(evento) {
  const boton = evento.target.closest('button[data-bloque-id]');
  if (!boton) return;

  const bloque = bloquesActuales.find(b => String(b.id) === boton.dataset.bloqueId);
  if (bloque) abrirModalBloque(bloque);
}

// Desde el detalle se salta directo a editar ese entregable.
function editarEntregableDelDetalle() {
  const entregable = entregablesCache.find(e => e.id === entregableDelDetalle);
  cerrarModalBloque();
  if (!entregable) return;

  cambiarTab('entregables');
  llenarFormularioEntregable(entregable);
  document.getElementById('form-entregable').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Regla 8 del algoritmo: si algo no cupo antes de su fecha límite,
// se avisa explícitamente en vez de fallar en silencio.
function mostrarAvisos(avisos) {
  const contenedor = document.getElementById('plan-avisos');

  if (!avisos || avisos.length === 0) {
    contenedor.classList.add('hidden');
    contenedor.innerHTML = '';
    return;
  }

  contenedor.classList.remove('hidden');
  contenedor.innerHTML = avisos.map(a => `
    <div class="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
      ⚠️ ${a.mensaje}
    </div>
  `).join('');
}

async function manejarGenerarPlan() {
  const boton = document.getElementById('plan-generar');
  boton.disabled = true;
  boton.textContent = 'Generando…';

  try {
    const resultado = await api.plan.generar();
    mostrarToast('exito', resultado.mensaje);
    mostrarAvisos(resultado.avisos);
    await cargarPlan();
  } catch (error) {
    mostrarToast('error', `No se pudo generar el horario: ${error.message}`);
  } finally {
    boton.disabled = false;
    boton.textContent = 'Generar horario';
  }
}

function inicializarPlan() {
  document.getElementById('plan-generar').addEventListener('click', manejarGenerarPlan);
  document.getElementById('form-configuracion').addEventListener('submit', manejarSubmitConfiguracion);
  document.getElementById('plan-calendario-envoltura').addEventListener('click', manejarClicCalendario);
  document.getElementById('bloque-cerrar').addEventListener('click', cerrarModalBloque);
  document.getElementById('bloque-editar').addEventListener('click', editarEntregableDelDetalle);
  document.getElementById('modal-bloque').addEventListener('click', (evento) => {
    // Solo cierra si el clic fue en el fondo oscuro, no en la tarjeta.
    if (evento.target.id === 'modal-bloque') cerrarModalBloque();
  });
  cargarPlan();
}
