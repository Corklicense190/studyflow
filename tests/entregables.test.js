// ============================================================
// tests/entregables.test.js
// Reglas de negocio del tipo de entregable y su dificultad.
// Incluye una prueba de regresión: al agregar el tipo "tarea" el
// POST empezó a exigir "dificultad" también para examen y
// evidencia, que el frontend no la manda (es automática), y crear
// un examen desde la interfaz devolvía 400.
// ============================================================

process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'secreto-de-prueba-solo-para-jest';

const request = require('supertest');
const app = require('../app');

function fechaEnDias(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

describe('Dificultad según el tipo de entregable', () => {
  let agente;

  beforeAll(async () => {
    agente = request.agent(app);
    await agente.post('/api/auth/registro').send({ nombre_usuario: 'estudiante', password: 'una-contrasena-larga-1' });
  });

  const base = () => ({ materia: 'Materia', fecha_limite: fechaEnDias(4), duracion_estimada: 2 });

  async function ultimoEntregable() {
    const lista = (await agente.get('/api/entregables')).body;
    return lista[lista.length - 1];
  }

  test.each(['examen', 'evidencia'])('%s se puede crear SIN mandar dificultad y queda en 5 automático', async (tipo) => {
    const respuesta = await agente.post('/api/entregables').send({ ...base(), tipo });

    expect(respuesta.status).toBe(201);
    expect((await ultimoEntregable()).dificultad).toBe(5);
  });

  test.each(['examen', 'evidencia'])('%s ignora la dificultad que mande el cliente: siempre 5', async (tipo) => {
    await agente.post('/api/entregables').send({ ...base(), tipo, dificultad: 1 });

    expect((await ultimoEntregable()).dificultad).toBe(5);
  });

  test('tarea exige dificultad al crearse (400 si falta)', async () => {
    const respuesta = await agente.post('/api/entregables').send({ ...base(), tipo: 'tarea' });

    expect(respuesta.status).toBe(400);
    expect(JSON.stringify(respuesta.body)).toMatch(/dificultad/);
  });

  test('tarea respeta la dificultad elegida', async () => {
    const respuesta = await agente.post('/api/entregables').send({ ...base(), tipo: 'tarea', dificultad: 2 });

    expect(respuesta.status).toBe(201);
    expect((await ultimoEntregable()).dificultad).toBe(2);
  });

  test('una dificultad fuera de rango se rechaza', async () => {
    const respuesta = await agente.post('/api/entregables').send({ ...base(), tipo: 'tarea', dificultad: 9 });

    expect(respuesta.status).toBe(400);
  });

  test('si una tarea se cambia a examen, la dificultad pasa a 5 automático', async () => {
    const creada = await agente.post('/api/entregables').send({ ...base(), tipo: 'tarea', dificultad: 1 });

    await agente.put(`/api/entregables/${creada.body.id}`).send({ tipo: 'examen' });

    const lista = (await agente.get('/api/entregables')).body;
    expect(lista.find(e => e.id === creada.body.id).dificultad).toBe(5);
  });
});
