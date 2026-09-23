// ============================================================
// algoritmo/priorizar.js
// Módulo PURO: no importa Express ni db/database.js. Recibe
// datos como argumentos y regresa resultados como objetos
// planos, para poder probarlo con Jest mandándole datos de
// prueba directo, sin levantar el servidor ni tocar SQLite
// (ver CLAUDE.md, sección "Por qué el algoritmo vive en su
// propio módulo").
//
// Convención interna de fechas: todo se maneja como string
// "YYYY-MM-DD" (o Date con esa fecha anclada en UTC). Quien
// use este módulo (el futuro router que lo conecte a Express)
// es responsable de convertir la fecha real del sistema a ese
// formato antes de llamar aquí. Así el algoritmo es 100%
// determinístico y no depende de la zona horaria del servidor
// donde corra Node.
// ============================================================

// ── Parámetros configurables (con valores por defecto) ───────
// Decisiones confirmadas con el usuario (no estaban en las 9
// reglas del CLAUDE.md, así que se preguntaron antes de suponer):
//   - Ventana diaria de estudio: 07:00–22:00.
//   - Límite diario de estudio (regla 4): 4 horas.
//   - Sí se permite agendar el mismo día de fecha_limite.
const VENTANA_INICIO_DEFECTO   = '07:00';
const VENTANA_FIN_DEFECTO      = '22:00';
const LIMITE_HORAS_DIA_DEFECTO = 4;

// Regla 6: bloque mínimo de estudio, nunca fragmentar más chico.
// Regla 7: mismo valor se usa como descanso mínimo obligatorio
// entre dos bloques de estudio consecutivos.
const BLOQUE_MINIMO_MINUTOS   = 30;
const DESCANSO_MINIMO_MINUTOS = 30;

// getUTCDay() de JavaScript regresa 0=domingo … 6=sábado, por
// eso este arreglo empieza en "domingo" para que el índice calce.
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// ── Utilidades de fecha ───────────────────────────────────────

// Convierte cualquier entrada (string "YYYY-MM-DD", string ISO
// completo como el que guarda la base de datos, o un Date) en un
// Date anclado a medianoche UTC de ese mismo día calendario.
// Trabajar siempre en UTC internamente evita el bug clásico de
// "se recorrió un día" cuando el proceso corre en una zona
// horaria distinta a UTC.
function normalizarFecha(entrada) {
  if (entrada instanceof Date) {
    return new Date(Date.UTC(entrada.getUTCFullYear(), entrada.getUTCMonth(), entrada.getUTCDate()));
  }

  // Si es string (con o sin hora/zona), nos quedamos solo con los
  // primeros 10 caracteres "YYYY-MM-DD".
  const [anio, mes, dia] = String(entrada).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia));
}

// Inverso de normalizarFecha: Date -> "YYYY-MM-DD".
function formatearFecha(fecha) {
  const anio = fecha.getUTCFullYear();
  const mes  = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const dia  = String(fecha.getUTCDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

// "Hoy" según el reloj LOCAL de la máquina (no UTC): a diferencia
// de las fechas guardadas, "hoy" sí depende de dónde vive el
// usuario. Si son las 8pm en México, ya es "mañana" en UTC, y
// eso daría una fecha incorrecta si se usaran los getters UTC aquí.
function fechaDeHoyPorDefecto() {
  const ahora = new Date();
  const anio  = ahora.getFullYear();
  const mes   = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia   = String(ahora.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

// Días de calendario completos entre dos fechas (puede dar negativo
// si "hasta" ya pasó respecto a "desde").
function diferenciaEnDias(desde, hasta) {
  return Math.round((normalizarFecha(hasta).getTime() - normalizarFecha(desde).getTime()) / MS_POR_DIA);
}

// Nombre del día de la semana (en minúsculas, sin acentos) para
// que coincida con los valores que usa horarios_fijos.dia_semana.
function diaDeLaSemana(fecha) {
  return DIAS_SEMANA[normalizarFecha(fecha).getUTCDay()];
}

// "HH:MM" -> minutos desde medianoche. Facilita sumar/restar/comparar.
function horaAMinutos(hora) {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

// Inverso de horaAMinutos.
function minutosAHora(minutos) {
  const horas = String(Math.floor(minutos / 60)).padStart(2, '0');
  const mins  = String(minutos % 60).padStart(2, '0');
  return `${horas}:${mins}`;
}

function sumarMinutos(bloques) {
  return bloques.reduce((total, b) => total + (horaAMinutos(b.hora_fin) - horaAMinutos(b.hora_inicio)), 0);
}

// ── Prioridad (regla 1) ───────────────────────────────────────

// Peso de urgencia = max(10 - días_restantes, 1). Nunca baja de 1
// para que un entregable lejano no quede en prioridad 0 (seguiría
// compitiendo por espacio, solo que al final de la fila).
function calcularUrgencia(diasRestantes) {
  return Math.max(10 - diasRestantes, 1);
}

// Adjunta a un entregable sus campos calculados: días restantes
// respecto a "hoy", urgencia, y la prioridad final (urgencia × dificultad).
function calcularPrioridad(entregable, hoy) {
  const diasRestantes = diferenciaEnDias(hoy, entregable.fecha_limite);
  const urgencia = calcularUrgencia(diasRestantes);

  return {
    ...entregable,
    diasRestantes,
    urgencia,
    prioridad: urgencia * entregable.dificultad,
  };
}

// Ordena entregables de mayor a menor prioridad.
// Desempate (regla 2): 1) fecha límite más próxima, 2) orden de
// registro (el que se registró primero en la lista de entrada gana).
function ordenarPorPrioridad(entregables, hoy) {
  return entregables
    .map((entregable, indiceOriginal) => ({ ...calcularPrioridad(entregable, hoy), indiceOriginal }))
    .sort((a, b) => {
      if (b.prioridad !== a.prioridad) return b.prioridad - a.prioridad;

      const fechaA = normalizarFecha(a.fecha_limite).getTime();
      const fechaB = normalizarFecha(b.fecha_limite).getTime();
      if (fechaA !== fechaB) return fechaA - fechaB;

      return a.indiceOriginal - b.indiceOriginal;
    });
}

// ── Disponibilidad de tiempo ──────────────────────────────────

// Lista de fechas "YYYY-MM-DD" desde "hoy" hasta "fechaLimite"
// (ambas inclusive, según se confirmó con el usuario: sí se puede
// estudiar el mismo día de la entrega). Si fechaLimite ya pasó,
// regresa un arreglo vacío — eso hace que el entregable termine
// en la lista de avisos de "no alcanzó el tiempo" (regla 8) en
// vez de romper el programa.
function generarDiasDisponibles(hoy, fechaLimite) {
  const inicio = normalizarFecha(hoy);
  const fin    = normalizarFecha(fechaLimite);
  const dias   = [];

  for (let t = inicio.getTime(); t <= fin.getTime(); t += MS_POR_DIA) {
    dias.push(formatearFecha(new Date(t)));
  }

  return dias;
}

// Calcula los huecos libres (en minutos, dentro de la ventana
// diaria) para un día concreto, dadas sus clases (horarios_fijos)
// y los bloques de estudio ya colocados ese día.
//
// Las clases ocupan exactamente su horario (regla 3: no se puede
// pisar). Los bloques de estudio, en cambio, se "inflan" 30 min
// a cada lado (regla 7: descanso obligatorio) antes de calcular
// el hueco libre, así cualquier bloque NUEVO que se coloque en
// ese hueco automáticamente respeta el descanso frente a bloques
// ya existentes.
function calcularHuecosLibres(ventanaInicio, ventanaFin, clasesDelDia, bloquesDelDia) {
  const inicioVentana = horaAMinutos(ventanaInicio);
  const finVentana     = horaAMinutos(ventanaFin);

  const ocupados = [
    ...clasesDelDia.map(c => ({
      inicio: horaAMinutos(c.hora_inicio),
      fin: horaAMinutos(c.hora_fin),
    })),
    ...bloquesDelDia.map(b => ({
      inicio: Math.max(inicioVentana, horaAMinutos(b.hora_inicio) - DESCANSO_MINIMO_MINUTOS),
      fin: Math.min(finVentana, horaAMinutos(b.hora_fin) + DESCANSO_MINIMO_MINUTOS),
    })),
  ].sort((a, b) => a.inicio - b.inicio);

  // Fusionamos intervalos que se solapen o se toquen, para no
  // contar dos veces el mismo tiempo ocupado.
  const fusionados = [];
  for (const intervalo of ocupados) {
    const ultimo = fusionados[fusionados.length - 1];
    if (ultimo && intervalo.inicio <= ultimo.fin) {
      ultimo.fin = Math.max(ultimo.fin, intervalo.fin);
    } else {
      fusionados.push({ ...intervalo });
    }
  }

  // Los huecos libres son el complemento de "fusionados" dentro
  // de la ventana diaria.
  const huecos = [];
  let cursor = inicioVentana;
  for (const bloque of fusionados) {
    if (bloque.inicio > cursor) {
      huecos.push({ inicio: cursor, fin: Math.min(bloque.inicio, finVentana) });
    }
    cursor = Math.max(cursor, bloque.fin);
  }
  if (cursor < finVentana) {
    huecos.push({ inicio: cursor, fin: finVentana });
  }

  // Descartamos huecos más chicos que el bloque mínimo (regla 6):
  // no sirven para nada, nadie estudia 10 minutos sueltos.
  return huecos.filter(h => h.fin - h.inicio >= BLOQUE_MINIMO_MINUTOS);
}

// ── Generación del plan completo ──────────────────────────────

/**
 * Genera bloques de estudio nuevos para una lista de entregables,
 * respetando horarios fijos, bloques ya existentes y las 9 reglas
 * del algoritmo descritas en CLAUDE.md.
 *
 * Uso incremental (regla 9): si "entregables" trae solo el
 * entregable que se acaba de agregar/editar, y "bloquesExistentes"
 * trae TODOS los bloques ya asignados de la base de datos, el
 * resultado ubica el cambio sin tocar lo ya asignado.
 *
 * Uso de recálculo total: se llama con TODOS los entregables y
 * "bloquesExistentes" vacío (borrón y cuenta nueva). La decisión
 * de cuándo usar cada modo vive en la capa que conecte este
 * módulo con las rutas de Express (aún no construida).
 *
 * @param {Array} entregables - entregables a agendar en esta pasada.
 * @param {Array} horariosFijos - clases/compromisos recurrentes.
 * @param {Array} bloquesExistentes - bloques ya asignados (contexto).
 * @param {Object} opciones - { hoy, ventanaInicio, ventanaFin, limiteHorasPorDia }
 * @returns {{ bloques: Array, avisos: Array }}
 */
function generarPlanEstudio(entregables, horariosFijos, bloquesExistentes = [], opciones = {}) {
  const hoy               = opciones.hoy || fechaDeHoyPorDefecto();
  const ventanaInicio      = opciones.ventanaInicio || VENTANA_INICIO_DEFECTO;
  const ventanaFin         = opciones.ventanaFin || VENTANA_FIN_DEFECTO;
  const limiteHorasPorDia  = opciones.limiteHorasPorDia ?? LIMITE_HORAS_DIA_DEFECTO;

  const ordenados = ordenarPorPrioridad(entregables, hoy);

  // Copia mutable: aquí se van acumulando tanto los bloques que ya
  // existían como los nuevos, para que cada nueva colocación "vea"
  // todo lo anterior (necesario para respetar el límite diario y
  // el descanso obligatorio entre TODOS los entregables, no solo
  // el que se está agendando en el momento).
  const bloques = [...bloquesExistentes];
  const nuevosBloques = [];
  const avisos = [];

  for (const entregable of ordenados) {
    let minutosPendientes = entregable.duracion_estimada * 60;
    const dias = generarDiasDisponibles(hoy, entregable.fecha_limite);

    for (const fecha of dias) {
      if (minutosPendientes <= 0) break;

      const diaSemana = diaDeLaSemana(fecha);
      const clasesDelDia = horariosFijos.filter(h => h.dia_semana === diaSemana);

      let capacidadRestanteHoy = limiteHorasPorDia * 60 - sumarMinutos(bloques.filter(b => b.fecha === fecha));

      // Regla 4: si el día ya está en (o sobre) su límite configurado
      // por otros entregables de mayor prioridad, se salta por
      // completo — el excedente queda para el siguiente día
      // disponible, que es justo lo que hace el for exterior.
      if (capacidadRestanteHoy < BLOQUE_MINIMO_MINUTOS) continue;

      // Se recalculan los huecos libres después de CADA bloque
      // colocado (en vez de una sola vez por día) para que el
      // descanso obligatorio (regla 7) quede garantizado incluso
      // si el siguiente hueco libre del día quedara a menos de
      // 30 min de un bloque recién asignado.
      let siguioColocando = true;
      while (minutosPendientes > 0 && capacidadRestanteHoy >= BLOQUE_MINIMO_MINUTOS && siguioColocando) {
        siguioColocando = false;

        const bloquesDelDia = bloques.filter(b => b.fecha === fecha);
        const huecos = calcularHuecosLibres(ventanaInicio, ventanaFin, clasesDelDia, bloquesDelDia);

        for (const hueco of huecos) {
          const disponibleHueco = hueco.fin - hueco.inicio;

          // El bloque no puede exceder: lo que falta por agendar,
          // el hueco físico disponible (regla 5), ni lo que queda
          // del límite diario configurado (regla 4).
          let minutos = Math.min(minutosPendientes, disponibleHueco, capacidadRestanteHoy);
          // Redondeamos hacia abajo a múltiplos de 30 (regla 6:
          // nunca fragmentar en sesiones más chicas que el mínimo).
          minutos = Math.floor(minutos / BLOQUE_MINIMO_MINUTOS) * BLOQUE_MINIMO_MINUTOS;

          if (minutos < BLOQUE_MINIMO_MINUTOS) continue;

          const nuevoBloque = {
            entregable_id: entregable.id,
            fecha,
            hora_inicio: minutosAHora(hueco.inicio),
            hora_fin: minutosAHora(hueco.inicio + minutos),
          };

          bloques.push(nuevoBloque);
          nuevosBloques.push(nuevoBloque);
          minutosPendientes -= minutos;
          capacidadRestanteHoy -= minutos;
          siguioColocando = true;
          break; // volver a recalcular huecos desde cero tras cada bloque
        }
      }
    }

    // Regla 8: si no alcanzó el tiempo antes de la fecha límite,
    // se avisa explícitamente en vez de fallar en silencio. Lo que
    // sí se pudo agendar (nuevosBloques) se conserva de todas formas.
    if (minutosPendientes > 0) {
      avisos.push({
        entregable_id: entregable.id,
        materia: entregable.materia,
        minutosFaltantes: minutosPendientes,
        mensaje: `No hubo tiempo suficiente antes de la fecha límite para "${entregable.materia}". ` +
                 `Faltaron ${(minutosPendientes / 60).toFixed(1)} horas por agendar.`,
      });
    }
  }

  return { bloques: nuevosBloques, avisos };
}

module.exports = {
  calcularUrgencia,
  calcularPrioridad,
  ordenarPorPrioridad,
  generarDiasDisponibles,
  calcularHuecosLibres,
  generarPlanEstudio,
  // Utilidades expuestas para poder probarlas de forma aislada con Jest.
  horaAMinutos,
  minutosAHora,
  diaDeLaSemana,
  diferenciaEnDias,
};
