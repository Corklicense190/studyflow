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

// Misma ventana horaria que algoritmo/priorizar.js (07:00-22:00).
// Se duplica aquí en JS de navegador porque ese módulo usa
// module.exports (CommonJS) y no se puede cargar tal cual con un
// <script> normal sin un bundler — para 2 funciones tan chicas no
// vale la pena meter herramientas nuevas al proyecto.
function horaAMinutosLocal(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

const VENTANA_INICIO_MIN = horaAMinutosLocal('07:00');
const VENTANA_FIN_MIN    = horaAMinutosLocal('22:00');
const PX_POR_MINUTO      = 0.8;

const DIAS_SEMANA_LOCAL = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const COLOR_POR_TIPO = {
  examen: 'bg-rose-400 text-white',
  evidencia: 'bg-indigo-400 text-white',
  tarea: 'bg-amber-400 text-white',
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

async function cargarPlan() {
  try {
    const [bloques, horarios] = await Promise.all([
      api.plan.obtener(),
      api.horarios.listar(),
    ]);
    horariosParaCalendario = horarios;
    renderizarCalendario(bloques);
  } catch (error) {
    mostrarToast('error', `No se pudo cargar el plan: ${error.message}`);
  }
}

// Un solo bloque posicionado dentro de su columna de día, usando
// top/height en px calculados a partir de la hora exacta. Muestra
// la etiqueta (materia o descripcion) arriba y el rango de horas
// pegado abajo a la derecha, pedido explícitamente para poder ver
// de un vistazo cuánto dura cada bloque sin tener que pasar el mouse.
// "etiqueta" ya viene escapada por el servidor — segura tanto en
// el contenido del div como en el atributo title.
function bloqueHtml(horaInicio, horaFin, etiqueta, clasesColor) {
  const inicioMin = horaAMinutosLocal(horaInicio);
  const finMin = horaAMinutosLocal(horaFin);
  const top = (inicioMin - VENTANA_INICIO_MIN) * PX_POR_MINUTO;
  const alto = (finMin - inicioMin) * PX_POR_MINUTO;

  return `
    <div class="calendario-bloque ${clasesColor}" style="top:${top}px;height:${alto}px" title="${etiqueta} (${horaInicio}-${horaFin})">
      <span>${etiqueta}</span>
      <span class="calendario-bloque-horas">${horaInicio}-${horaFin}</span>
    </div>
  `;
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
  const alturaTotal = (VENTANA_FIN_MIN - VENTANA_INICIO_MIN) * PX_POR_MINUTO;

  let html = `
    <div class="flex items-center gap-4 text-xs text-gray-600 mb-3">
      <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-rose-400"></span> Examen</span>
      <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-indigo-400"></span> Evidencia</span>
      <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-amber-400"></span> Tarea</span>
      <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-gray-300"></span> Clase</span>
    </div>
    <div class="calendario-grid" style="--dias:${dias.length}">
  `;

  // Columna de etiquetas de hora (cada hora en punto, de 07:00 a 22:00).
  html += `<div class="relative" style="height:${alturaTotal}px">`;
  for (let min = VENTANA_INICIO_MIN; min <= VENTANA_FIN_MIN; min += 60) {
    const top = (min - VENTANA_INICIO_MIN) * PX_POR_MINUTO;
    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    html += `<div class="absolute text-[10px] text-gray-400 -translate-y-1/2" style="top:${top}px">${hh}:00</div>`;
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

    for (let min = VENTANA_INICIO_MIN; min <= VENTANA_FIN_MIN; min += 60) {
      const top = (min - VENTANA_INICIO_MIN) * PX_POR_MINUTO;
      html += `<div class="calendario-linea-hora" style="top:${top}px"></div>`;
    }

    // Clases fijas primero (gris, de contexto), luego los bloques
    // de estudio encima (colores según tipo de entregable).
    for (const clase of clasesDelDia) {
      html += bloqueHtml(clase.hora_inicio, clase.hora_fin, clase.descripcion || 'Clase', 'bg-gray-300 text-gray-700');
    }
    for (const bloque of bloquesDelDia) {
      const color = COLOR_POR_TIPO[bloque.tipo] || COLOR_POR_TIPO.tarea;
      html += bloqueHtml(bloque.hora_inicio, bloque.hora_fin, bloque.materia, color);
    }

    html += `</div></div>`;
  }

  html += `</div>`;
  envoltura.innerHTML = html;
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
  cargarPlan();
}
