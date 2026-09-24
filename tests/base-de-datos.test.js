// ============================================================
// tests/base-de-datos.test.js
// Comportamiento de la capa de datos contra Postgres REAL (PGlite,
// ver db/database.js): transacciones atómicas, restricciones de
// integridad y que el esquema se pueda aplicar más de una vez.
// ============================================================

process.env.NODE_ENV = 'test';

const db = require('../db/database');

async function crearUsuario(nombre) {
  const fila = await db.consultarUna(
    'INSERT INTO usuarios (nombre_usuario, nombre_normalizado, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [nombre, nombre.toLowerCase(), 'hash-de-prueba']
  );
  return fila.id;
}

const contar = async (tabla) => (await db.consultarUna(`SELECT count(*)::int AS n FROM ${tabla}`)).n;

beforeAll(() => db.listo);

describe('Transacciones', () => {
  test('si algo falla a la mitad, NO queda nada guardado (ROLLBACK real)', async () => {
    const antes = await contar('usuarios');

    await expect(db.transaccion(async (tx) => {
      await tx.ejecutar(
        'INSERT INTO usuarios (nombre_usuario, nombre_normalizado, password_hash) VALUES ($1, $2, $3)',
        ['Medio', 'medio', 'h']
      );
      throw new Error('falla a la mitad');
    })).rejects.toThrow('falla a la mitad');

    expect(await contar('usuarios')).toBe(antes);
  });

  test('si todo sale bien, se guarda completo (COMMIT)', async () => {
    const antes = await contar('usuarios');

    const id = await db.transaccion(async (tx) => {
      const fila = await tx.consultarUna(
        'INSERT INTO usuarios (nombre_usuario, nombre_normalizado, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Completo', 'completo', 'h']
      );
      await tx.ejecutar('INSERT INTO configuracion (usuario_id) VALUES ($1)', [fila.id]);
      return fila.id;
    });

    expect(await contar('usuarios')).toBe(antes + 1);
    expect((await db.consultarUna('SELECT usuario_id FROM configuracion WHERE usuario_id = $1', [id])).usuario_id).toBe(id);
  });
});

describe('Restricciones de integridad', () => {
  test('un nombre de usuario repetido viola UNIQUE (código 23505, el que maneja routes/auth.js)', async () => {
    await crearUsuario('Unico');

    await expect(crearUsuario('UNICO')).rejects.toMatchObject({ code: '23505' });
  });

  test('una dificultad fuera de 1-5 viola el CHECK', async () => {
    const usuarioId = await crearUsuario('Check');

    await expect(db.ejecutar(
      `INSERT INTO entregables (usuario_id, materia, tipo, fecha_limite, dificultad, duracion_estimada)
       VALUES ($1, 'x', 'tarea', '2026-01-01', 9, 1)`,
      [usuarioId]
    )).rejects.toMatchObject({ code: '23514' });
  });

  test('no se puede crear un entregable para un usuario que no existe (llave foránea)', async () => {
    await expect(db.ejecutar(
      `INSERT INTO entregables (usuario_id, materia, tipo, fecha_limite, dificultad, duracion_estimada)
       VALUES (999999, 'x', 'tarea', '2026-01-01', 3, 1)`
    )).rejects.toMatchObject({ code: '23503' });
  });

  test('al borrar un usuario se borran en cascada sus entregables, bloques y configuración', async () => {
    const usuarioId = await crearUsuario('Cascada');
    await db.ejecutar('INSERT INTO configuracion (usuario_id) VALUES ($1)', [usuarioId]);
    const entregable = await db.consultarUna(
      `INSERT INTO entregables (usuario_id, materia, tipo, fecha_limite, dificultad, duracion_estimada)
       VALUES ($1, 'x', 'examen', '2026-01-01', 5, 1) RETURNING id`,
      [usuarioId]
    );
    await db.ejecutar(
      "INSERT INTO bloques_estudio (entregable_id, fecha, hora_inicio, hora_fin) VALUES ($1, '2026-01-01', '08:00', '09:00')",
      [entregable.id]
    );

    await db.ejecutar('DELETE FROM usuarios WHERE id = $1', [usuarioId]);

    expect((await db.consultar('SELECT 1 FROM entregables WHERE usuario_id = $1', [usuarioId]))).toHaveLength(0);
    expect((await db.consultar('SELECT 1 FROM bloques_estudio WHERE entregable_id = $1', [entregable.id]))).toHaveLength(0);
    expect((await db.consultar('SELECT 1 FROM configuracion WHERE usuario_id = $1', [usuarioId]))).toHaveLength(0);
  });
});

describe('Consultas parametrizadas', () => {
  test('un intento de inyección SQL en un parámetro se trata como texto, no como SQL', async () => {
    const intento = "x'; DROP TABLE usuarios; --";

    const fila = await db.consultarUna('SELECT id FROM usuarios WHERE nombre_normalizado = $1', [intento]);

    expect(fila).toBeNull();
    expect(await contar('usuarios')).toBeGreaterThan(0); // la tabla sigue ahí
  });
});
