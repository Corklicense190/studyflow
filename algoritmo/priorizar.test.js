// ============================================================
// algoritmo/priorizar.test.js
// Pruebas Jest del módulo del algoritmo. Se prueban datos
// directos, sin levantar el servidor ni tocar SQLite (por eso
// el módulo vive separado de Express/db, ver CLAUDE.md).
//
// Cada describe() corresponde a una regla numerada del CLAUDE.md
// para que sea fácil ubicar qué prueba defiende qué regla.
// ============================================================

const {
  calcularUrgencia,
  ordenarPorPrioridad,
  generarDiasDisponibles,
  calcularHuecosLibres,
  generarPlanEstudio,
  horaAMinutos,
  minutosAHora,
  diaDeLaSemana,
  diferenciaEnDias,
} = require('./priorizar');

// ── Utilidad de prueba: ¿dos rangos horarios se solapan? ──────
function seSolapan(inicioA, finA, inicioB, finB) {
  return horaAMinutos(inicioA) < horaAMinutos(finB) && horaAMinutos(finA) > horaAMinutos(inicioB);
}

describe('Regla 1: prioridad = urgencia x dificultad', () => {
  test('caso exacto del CLAUDE.md: examen en 2 dias, dificultad 5 -> urgencia 8, prioridad 40', () => {
    expect(calcularUrgencia(2)).toBe(8);
    expect(calcularUrgencia(2) * 5).toBe(40);
  });

  test('caso exacto del CLAUDE.md: evidencia en 6 dias, dificultad 3 -> urgencia 4, prioridad 12', () => {
    expect(calcularUrgencia(6)).toBe(4);
    expect(calcularUrgencia(6) * 3).toBe(12);
  });

  test('la urgencia nunca baja de 1, aunque falten muchos dias', () => {
    expect(calcularUrgencia(30)).toBe(1);
  });

  test('si ya se vencio (dias negativos), la urgencia sigue siendo alta, no negativa', () => {
    expect(calcularUrgencia(-3)).toBe(13);
  });
});

describe('Regla 2: desempate por fecha limite y orden de registro', () => {
  test('a prioridad igual, gana la fecha limite mas proxima', () => {
    const hoy = '2026-01-01';
    const entregables = [
      { id: 1, materia: 'A (lejos)', fecha_limite: '2026-01-10', dificultad: 1, duracion_estimada: 1 },
      { id: 2, materia: 'B (cerca)', fecha_limite: '2026-01-05', dificultad: 1, duracion_estimada: 1 },
    ];
    // Ambos con dificultad 1 pero distinta urgencia por fecha; para
    // aislar el desempate puro forzamos prioridad igual manualmente
    // dandoles la misma dificultad y comparando solo el orden final
    // cuando la urgencia coincide (dias_restantes iguales).
    const mismasFechas = [
      { id: 1, materia: 'A (registrado primero)', fecha_limite: '2026-01-05', dificultad: 2, duracion_estimada: 1 },
      { id: 2, materia: 'B (registrado despues)', fecha_limite: '2026-01-05', dificultad: 2, duracion_estimada: 1 },
    ];

    const ordenPorFecha = ordenarPorPrioridad(entregables, hoy);
    expect(ordenPorFecha[0].materia).toBe('B (cerca)');

    const ordenPorRegistro = ordenarPorPrioridad(mismasFechas, hoy);
    expect(ordenPorRegistro[0].materia).toBe('A (registrado primero)');
  });
});

describe('Regla 3: ningun bloque de estudio pisa una clase ni otro bloque', () => {
  test('el algoritmo esquiva un bloque de clase real', () => {
    const hoy = '2026-01-01'; // jueves
    const entregables = [
      { id: 1, materia: 'Examen', fecha_limite: '2026-01-01', dificultad: 5, duracion_estimada: 3 },
    ];
    const horariosFijos = [
      { dia_semana: 'jueves', hora_inicio: '09:00', hora_fin: '13:00' },
    ];

    const { bloques } = generarPlanEstudio(entregables, horariosFijos, [], { hoy });

    for (const b of bloques) {
      expect(seSolapan(b.hora_inicio, b.hora_fin, '09:00', '13:00')).toBe(false);
    }
    // Y de todas formas alcanzo a agendar las 3 horas ese mismo dia.
    const totalMinutos = bloques.reduce((t, b) => t + (horaAMinutos(b.hora_fin) - horaAMinutos(b.hora_inicio)), 0);
    expect(totalMinutos).toBe(180);
  });

  test('dos entregables nunca terminan con bloques que se solapan entre si', () => {
    const hoy = '2026-01-01';
    const entregables = [
      { id: 1, materia: 'A', fecha_limite: '2026-01-01', dificultad: 5, duracion_estimada: 4 },
      { id: 2, materia: 'B', fecha_limite: '2026-01-01', dificultad: 5, duracion_estimada: 4 },
    ];

    const { bloques } = generarPlanEstudio(entregables, [], [], { hoy, limiteHorasPorDia: 8 });
    const ordenados = [...bloques].sort((a, b) => horaAMinutos(a.hora_inicio) - horaAMinutos(b.hora_inicio));

    for (let i = 1; i < ordenados.length; i++) {
      expect(seSolapan(
        ordenados[i - 1].hora_inicio, ordenados[i - 1].hora_fin,
        ordenados[i].hora_inicio, ordenados[i].hora_fin
      )).toBe(false);
    }
  });
});

describe('Regla 4: limite diario configurado y redistribucion al dia siguiente', () => {
  test('si un entregable pide mas horas que el limite diario, el excedente se mueve a otro dia', () => {
    const hoy = '2026-01-01';
    const entregables = [
      { id: 1, materia: 'Proyecto grande', fecha_limite: '2026-01-05', dificultad: 3, duracion_estimada: 6 },
    ];

    const { bloques } = generarPlanEstudio(entregables, [], [], { hoy, limiteHorasPorDia: 4 });

    const minutosPorDia = {};
    for (const b of bloques) {
      minutosPorDia[b.fecha] = (minutosPorDia[b.fecha] || 0) + (horaAMinutos(b.hora_fin) - horaAMinutos(b.hora_inicio));
    }

    // Ningun dia individual debe superar el limite configurado (4h = 240 min).
    for (const fecha in minutosPorDia) {
      expect(minutosPorDia[fecha]).toBeLessThanOrEqual(240);
    }
    // Se usaron al menos dos dias distintos para las 6 horas totales.
    expect(Object.keys(minutosPorDia).length).toBeGreaterThanOrEqual(2);
  });

  test('el limite diario se respeta entre VARIOS entregables el mismo dia, no solo uno', () => {
    const hoy = '2026-01-01';
    const entregables = [
      { id: 1, materia: 'A (mas urgente)', fecha_limite: '2026-01-01', dificultad: 5, duracion_estimada: 3 },
      { id: 2, materia: 'B (menos urgente)', fecha_limite: '2026-01-02', dificultad: 5, duracion_estimada: 3 },
    ];

    const { bloques } = generarPlanEstudio(entregables, [], [], { hoy, limiteHorasPorDia: 4 });

    const minutosDia1 = bloques
      .filter(b => b.fecha === '2026-01-01')
      .reduce((t, b) => t + (horaAMinutos(b.hora_fin) - horaAMinutos(b.hora_inicio)), 0);

    // A (mas prioritario) se agenda primero y llena el dia 1 (3h de sus
    // 3h). B ya no cabe completo ese dia dentro del limite de 4h, asi
    // que como maximo puede meter 1h ahi y el resto se va al dia 2.
    expect(minutosDia1).toBeLessThanOrEqual(240);

    const totalB = bloques
      .filter(b => b.entregable_id === 2)
      .reduce((t, b) => t + (horaAMinutos(b.hora_fin) - horaAMinutos(b.hora_inicio)), 0);
    expect(totalB).toBe(180); // B igual completa sus 3 horas, solo que repartidas
  });
});

describe('Regla 6: bloque minimo de 30 minutos', () => {
  test('ningun bloque generado dura menos de 30 minutos', () => {
    const hoy = '2026-01-01';
    const entregables = [
      { id: 1, materia: 'A', fecha_limite: '2026-01-03', dificultad: 5, duracion_estimada: 5 },
    ];
    const horariosFijos = [
      // Deja huecos chicos a proposito para forzar el redondeo.
      { dia_semana: 'jueves', hora_inicio: '07:20', hora_fin: '21:50' },
    ];

    const { bloques } = generarPlanEstudio(entregables, horariosFijos, [], { hoy });

    for (const b of bloques) {
      expect(horaAMinutos(b.hora_fin) - horaAMinutos(b.hora_inicio)).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('Regla 7: descanso obligatorio de 30 minutos entre bloques consecutivos', () => {
  test('siempre hay al menos 30 min entre dos bloques del mismo dia', () => {
    const hoy = '2026-01-01';
    const entregables = [
      { id: 1, materia: 'A', fecha_limite: '2026-01-01', dificultad: 5, duracion_estimada: 2 },
      { id: 2, materia: 'B', fecha_limite: '2026-01-01', dificultad: 4, duracion_estimada: 2 },
    ];
    const horariosFijos = [
      // Una clase a medio dia obliga a repartir los bloques en dos huecos.
      { dia_semana: 'jueves', hora_inicio: '10:00', hora_fin: '11:00' },
    ];

    const { bloques } = generarPlanEstudio(entregables, horariosFijos, [], { hoy, limiteHorasPorDia: 8 });
    const ordenados = [...bloques].sort((a, b) => horaAMinutos(a.hora_inicio) - horaAMinutos(b.hora_inicio));

    for (let i = 1; i < ordenados.length; i++) {
      const gap = horaAMinutos(ordenados[i].hora_inicio) - horaAMinutos(ordenados[i - 1].hora_fin);
      expect(gap).toBeGreaterThanOrEqual(30);
    }
  });

  test('un bloque ya existente en la base de datos tambien exige el descanso', () => {
    const hoy = '2026-01-01';
    const bloqueExistente = [{ entregable_id: 5, fecha: '2026-01-01', hora_inicio: '08:00', hora_fin: '09:00' }];
    const entregables = [
      { id: 1, materia: 'Nuevo', fecha_limite: '2026-01-01', dificultad: 5, duracion_estimada: 1 },
    ];

    const { bloques } = generarPlanEstudio(entregables, [], bloqueExistente, { hoy });

    // El algoritmo puede repartir la hora en mas de un bloque si eso
    // aprovecha huecos validos (ej. un huequito de 30 min que quedo
    // libre antes del bloque existente) — eso no viola ninguna regla,
    // asi que lo que se verifica es la invariante real: ningun bloque
    // nuevo queda a menos de 30 min del bloque existente (08:00-09:00).
    for (const b of bloques) {
      const antes = horaAMinutos(b.hora_fin) <= horaAMinutos('08:00') &&
        horaAMinutos('08:00') - horaAMinutos(b.hora_fin) >= 30;
      const despues = horaAMinutos(b.hora_inicio) >= horaAMinutos('09:00') &&
        horaAMinutos(b.hora_inicio) - horaAMinutos('09:00') >= 30;
      expect(antes || despues).toBe(true);
    }

    const totalMinutos = bloques.reduce((t, b) => t + (horaAMinutos(b.hora_fin) - horaAMinutos(b.hora_inicio)), 0);
    expect(totalMinutos).toBe(60);
  });
});

describe('Regla 8: si no alcanza el tiempo, avisa en vez de fallar en silencio', () => {
  test('un entregable con fecha limite hoy y muchas horas genera un aviso', () => {
    const hoy = '2026-01-01';
    const entregables = [
      { id: 1, materia: 'Tesis urgente', fecha_limite: '2026-01-01', dificultad: 5, duracion_estimada: 20 },
    ];

    const { bloques, avisos } = generarPlanEstudio(entregables, [], [], { hoy });

    expect(avisos).toHaveLength(1);
    expect(avisos[0].entregable_id).toBe(1);
    expect(avisos[0].minutosFaltantes).toBeGreaterThan(0);
    // Y aun asi agendo lo que si cupo, no se quedo en cero.
    expect(bloques.length).toBeGreaterThan(0);
  });

  test('una fecha limite ya vencida no rompe el programa, solo avisa', () => {
    const hoy = '2026-01-10';
    const entregables = [
      { id: 1, materia: 'Ya vencido', fecha_limite: '2026-01-01', dificultad: 3, duracion_estimada: 2 },
    ];

    expect(() => generarPlanEstudio(entregables, [], [], { hoy })).not.toThrow();
    const { bloques, avisos } = generarPlanEstudio(entregables, [], [], { hoy });
    expect(bloques).toHaveLength(0);
    expect(avisos).toHaveLength(1);
  });
});

describe('Regla 9: uso incremental no mueve lo ya asignado', () => {
  test('agendar un entregable nuevo no modifica los bloques ya existentes', () => {
    const hoy = '2026-01-01';
    const bloquesExistentes = [
      { entregable_id: 1, fecha: '2026-01-01', hora_inicio: '07:00', hora_fin: '08:00' },
    ];
    const entregableNuevo = [
      { id: 2, materia: 'Nuevo entregable', fecha_limite: '2026-01-01', dificultad: 4, duracion_estimada: 1 },
    ];

    const { bloques: bloquesNuevos } = generarPlanEstudio(entregableNuevo, [], bloquesExistentes, { hoy });

    // La funcion solo devuelve los bloques NUEVOS; el existente no
    // aparece modificado en ningun lado (nunca se toco su arreglo original).
    expect(bloquesExistentes).toEqual([
      { entregable_id: 1, fecha: '2026-01-01', hora_inicio: '07:00', hora_fin: '08:00' },
    ]);
    expect(bloquesNuevos.every(b => b.entregable_id === 2)).toBe(true);
  });
});

describe('Utilidades de fecha/hora', () => {
  test('horaAMinutos y minutosAHora son inversas', () => {
    expect(horaAMinutos('08:30')).toBe(510);
    expect(minutosAHora(510)).toBe('08:30');
  });

  test('diferenciaEnDias cuenta dias completos entre dos fechas', () => {
    expect(diferenciaEnDias('2026-01-01', '2026-01-03')).toBe(2);
  });

  test('diaDeLaSemana identifica correctamente un jueves conocido', () => {
    // 2026-01-01 es jueves (verificado contra calendario real).
    expect(diaDeLaSemana('2026-01-01')).toBe('jueves');
  });

  test('generarDiasDisponibles incluye hoy y la fecha limite (inclusive, segun se confirmo con el usuario)', () => {
    const dias = generarDiasDisponibles('2026-01-01', '2026-01-03');
    expect(dias).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  test('generarDiasDisponibles regresa vacio si la fecha limite ya paso', () => {
    expect(generarDiasDisponibles('2026-01-10', '2026-01-01')).toEqual([]);
  });
});

describe('calcularHuecosLibres', () => {
  test('sin clases ni bloques, el hueco es toda la ventana', () => {
    const huecos = calcularHuecosLibres('07:00', '22:00', [], []);
    expect(huecos).toEqual([{ inicio: horaAMinutos('07:00'), fin: horaAMinutos('22:00') }]);
  });

  test('una clase parte la ventana en dos huecos', () => {
    const huecos = calcularHuecosLibres('07:00', '22:00', [{ hora_inicio: '09:00', hora_fin: '11:00' }], []);
    expect(huecos).toEqual([
      { inicio: horaAMinutos('07:00'), fin: horaAMinutos('09:00') },
      { inicio: horaAMinutos('11:00'), fin: horaAMinutos('22:00') },
    ]);
  });

  test('un bloque de estudio existente infla su ocupacion 30 min a cada lado', () => {
    const huecos = calcularHuecosLibres('07:00', '22:00', [], [{ hora_inicio: '10:00', hora_fin: '11:00' }]);
    expect(huecos).toEqual([
      { inicio: horaAMinutos('07:00'), fin: horaAMinutos('09:30') },
      { inicio: horaAMinutos('11:30'), fin: horaAMinutos('22:00') },
    ]);
  });
});
