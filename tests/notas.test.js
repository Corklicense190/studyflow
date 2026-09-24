// ============================================================
// tests/notas.test.js
// Nota opcional por entregable (recordatorio de qué estudiar).
// Lo importante en seguridad: la nota se muestra en el navegador,
// así que se escapa como "materia"; y solo la ve su dueño.
// ============================================================

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'secreto-de-prueba-solo-para-jest';

const request = require('supertest');
const app = require('../app');

const PASSWORD = 'una-contrasena-larga-1';

function fechaEnDias(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

const base = () => ({ materia: 'Cálculo', tipo: 'examen', fecha_limite: fechaEnDias(5), duracion_estimada: 3 });

async function registrar(nombre) {
  const agente = request.agent(app);
  await agente.post('/api/auth/registro').send({ nombre_usuario: nombre, password: PASSWORD });
  return agente;
}

describe('Notas de un entregable', () => {
  let ana;
  let beto;

  beforeAll(async () => {
    ana = await registrar('ana_notas');
    beto = await registrar('beto_notas');
  });

  test('un entregable sin nota la guarda como texto vacío', async () => {
    const creada = await ana.post('/api/entregables').send(base());
    expect(creada.status).toBe(201);

    const lista = (await ana.get('/api/entregables')).body;
    expect(lista.find(e => e.id === creada.body.id).notas).toBe('');
  });

  test('se guarda la nota al crear y aparece en la lista', async () => {
    const creada = await ana.post('/api/entregables').send({ ...base(), notas: 'Repasar derivadas y límites' });
    expect(creada.status).toBe(201);

    const lista = (await ana.get('/api/entregables')).body;
    expect(lista.find(e => e.id === creada.body.id).notas).toBe('Repasar derivadas y límites');
  });

  test('editar sin mandar "notas" conserva la que ya tenía', async () => {
    const creada = await ana.post('/api/entregables').send({ ...base(), notas: 'Capítulo 3' });
    await ana.put(`/api/entregables/${creada.body.id}`).send({ duracion_estimada: 6 });

    const lista = (await ana.get('/api/entregables')).body;
    expect(lista.find(e => e.id === creada.body.id).notas).toBe('Capítulo 3');
  });

  test('mandar "notas" vacía al editar la borra', async () => {
    const creada = await ana.post('/api/entregables').send({ ...base(), notas: 'Capítulo 3' });
    const respuesta = await ana.put(`/api/entregables/${creada.body.id}`).send({ notas: '' });
    expect(respuesta.status).toBe(200);

    const lista = (await ana.get('/api/entregables')).body;
    expect(lista.find(e => e.id === creada.body.id).notas).toBe('');
  });

  test('el HTML de la nota se guarda escapado (no ejecutable)', async () => {
    const creada = await ana.post('/api/entregables').send({ ...base(), notas: '<script>alert(1)</script>' });
    expect(creada.status).toBe(201);

    const lista = (await ana.get('/api/entregables')).body;
    const notas = lista.find(e => e.id === creada.body.id).notas;
    expect(notas).not.toContain('<script>');
    expect(notas).toContain('&lt;script&gt;');
  });

  test('rechaza una nota de más de 500 caracteres y acepta una de exactamente 500', async () => {
    const larga = await ana.post('/api/entregables').send({ ...base(), notas: 'a'.repeat(501) });
    expect(larga.status).toBe(400);

    const justa = await ana.post('/api/entregables').send({ ...base(), notas: 'a'.repeat(500) });
    expect(justa.status).toBe(201);
  });

  test('rechaza una nota que no es texto', async () => {
    const respuesta = await ana.post('/api/entregables').send({ ...base(), notas: { $ne: 1 } });
    expect(respuesta.status).toBe(400);
  });

  test('el plan de estudio trae la nota y la fecha límite de cada bloque', async () => {
    await ana.post('/api/entregables').send({ ...base(), materia: 'Física', notas: 'Ley de Newton' });
    await ana.post('/api/plan/generar');

    const bloques = (await ana.get('/api/plan')).body;
    const deFisica = bloques.filter(b => b.materia === 'Física');
    expect(deFisica.length).toBeGreaterThan(0);
    expect(deFisica[0]).toMatchObject({ notas: 'Ley de Newton' });
    expect(deFisica[0].fecha_limite).toBeDefined();
  });

  test('otro usuario no puede ver ni editar la nota (404)', async () => {
    const creada = await ana.post('/api/entregables').send({ ...base(), notas: 'privada' });

    const editar = await beto.put(`/api/entregables/${creada.body.id}`).send({ notas: 'hackeada' });
    expect(editar.status).toBe(404);

    const listaDeBeto = (await beto.get('/api/entregables')).body;
    expect(JSON.stringify(listaDeBeto)).not.toContain('privada');
  });
});
