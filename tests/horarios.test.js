// ============================================================
// tests/horarios.test.js
// Horarios fijos: registrar varios días de una sola vez (la misma
// clase de lunes a viernes) en vez de uno por uno. La operación es
// "todo o nada": si algo falla, no se crea ningún día.
// ============================================================

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'secreto-de-prueba-solo-para-jest';

const request = require('supertest');
const app = require('../app');

const PASSWORD = 'una-contrasena-larga-1';
const base = () => ({ hora_inicio: '09:00', hora_fin: '11:00', descripcion: 'Clase de DevSecOps' });

async function registrar(nombre) {
  const agente = request.agent(app);
  await agente.post('/api/auth/registro').send({ nombre_usuario: nombre, password: PASSWORD });
  return agente;
}

describe('Horarios fijos con varios días', () => {
  let ana;
  let beto;

  beforeAll(async () => {
    ana = await registrar('ana_horarios');
    beto = await registrar('beto_horarios');
  });

  const lista = async (agente) => (await agente.get('/api/horarios-fijos')).body;

  test('un solo día con "dia_semana" sigue funcionando igual que antes', async () => {
    const respuesta = await ana.post('/api/horarios-fijos').send({ ...base(), dia_semana: 'sabado' });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.ids).toHaveLength(1);
    expect(respuesta.body.id).toBe(respuesta.body.ids[0]);
    expect((await lista(ana)).filter(h => h.dia_semana === 'sabado')).toHaveLength(1);
  });

  test('con "dias_semana" crea un horario por día, todos a la misma hora', async () => {
    const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];
    const respuesta = await ana.post('/api/horarios-fijos').send({ ...base(), dias_semana: dias });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.ids).toHaveLength(5);
    expect(respuesta.body.mensaje).toContain('5');

    const creados = (await lista(ana)).filter(h => respuesta.body.ids.includes(h.id));
    expect(creados.map(h => h.dia_semana).sort()).toEqual([...dias].sort());
    for (const h of creados) {
      expect(h).toMatchObject({ hora_inicio: '09:00', hora_fin: '11:00', descripcion: 'Clase de DevSecOps' });
    }
  });

  test('ignora los días repetidos y acepta mayúsculas', async () => {
    const respuesta = await ana.post('/api/horarios-fijos')
      .send({ ...base(), hora_inicio: '14:00', hora_fin: '15:00', dias_semana: ['Lunes', 'lunes', 'JUEVES'] });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.ids).toHaveLength(2);
  });

  test('sin ningún día responde 400 y no crea nada', async () => {
    const antes = (await lista(ana)).length;

    const respuesta = await ana.post('/api/horarios-fijos').send(base());
    expect(respuesta.status).toBe(400);
    expect((await lista(ana)).length).toBe(antes);
  });

  test('una lista vacía o de más de 7 días se rechaza', async () => {
    const vacia = await ana.post('/api/horarios-fijos').send({ ...base(), dias_semana: [] });
    const larga = await ana.post('/api/horarios-fijos')
      .send({ ...base(), dias_semana: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'lunes'] });

    expect(vacia.status).toBe(400);
    expect(larga.status).toBe(400);
  });

  test('un día inválido en la lista invalida todo: no se crea ninguno (todo o nada)', async () => {
    const antes = (await lista(ana)).length;

    const respuesta = await ana.post('/api/horarios-fijos')
      .send({ ...base(), dias_semana: ['lunes', 'martes', 'funday'] });

    expect(respuesta.status).toBe(400);
    expect((await lista(ana)).length).toBe(antes);
  });

  test('rechaza tipos que no son texto dentro de la lista (inyección de objetos)', async () => {
    const respuesta = await ana.post('/api/horarios-fijos')
      .send({ ...base(), dias_semana: [{ $ne: 1 }] });

    expect(respuesta.status).toBe(400);
  });

  test('rechaza una lista que no es lista', async () => {
    const respuesta = await ana.post('/api/horarios-fijos').send({ ...base(), dias_semana: 'lunes' });
    expect(respuesta.status).toBe(400);
  });

  test('las horas se siguen validando con varios días', async () => {
    const alReves = await ana.post('/api/horarios-fijos')
      .send({ ...base(), hora_inicio: '12:00', hora_fin: '10:00', dias_semana: ['lunes', 'martes'] });
    const sinHoras = await ana.post('/api/horarios-fijos').send({ dias_semana: ['lunes'] });

    expect(alReves.status).toBe(400);
    expect(sinHoras.status).toBe(400);
  });

  test('la descripción se guarda escapada en todos los días', async () => {
    const respuesta = await ana.post('/api/horarios-fijos')
      .send({ ...base(), descripcion: '<script>alert(1)</script>', dias_semana: ['martes', 'jueves'] });

    expect(respuesta.status).toBe(201);
    const creados = (await lista(ana)).filter(h => respuesta.body.ids.includes(h.id));
    expect(creados).toHaveLength(2);
    for (const h of creados) {
      expect(h.descripcion).not.toContain('<script>');
    }
  });

  test('los horarios creados quedan a nombre de quien los creó y otro usuario no los ve', async () => {
    const respuesta = await ana.post('/api/horarios-fijos')
      .send({ ...base(), dias_semana: ['domingo', 'sabado'], descripcion: 'Solo de Ana' });

    expect(respuesta.status).toBe(201);
    expect(JSON.stringify(await lista(beto))).not.toContain('Solo de Ana');

    const editar = await beto.put(`/api/horarios-fijos/${respuesta.body.ids[0]}`).send({ hora_fin: '23:00' });
    expect(editar.status).toBe(404);
  });

  test('editar un horario sigue siendo de un solo día', async () => {
    const creada = await ana.post('/api/horarios-fijos').send({ ...base(), dias_semana: ['viernes', 'sabado'] });
    const id = creada.body.ids[0];

    const respuesta = await ana.put(`/api/horarios-fijos/${id}`).send({ dia_semana: 'domingo', hora_fin: '12:00' });
    expect(respuesta.status).toBe(200);

    const editado = (await lista(ana)).find(h => h.id === id);
    expect(editado).toMatchObject({ dia_semana: 'domingo', hora_fin: '12:00' });
  });

  test('el plan de estudio respeta cada una de las clases creadas de golpe', async () => {
    const carlos = await registrar('carlos_horarios');
    // Clase de lunes a domingo de 07:00 a 22:00 = la ventana completa ocupada.
    await carlos.post('/api/horarios-fijos')
      .send({ hora_inicio: '07:00', hora_fin: '22:00', dias_semana: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] });

    const fecha = new Date();
    fecha.setDate(fecha.getDate() + 5);
    await carlos.post('/api/entregables')
      .send({ materia: 'Sin espacio', tipo: 'examen', fecha_limite: fecha.toISOString().slice(0, 10), duracion_estimada: 3 });

    const generado = await carlos.post('/api/plan/generar');
    expect(generado.status).toBe(201);
    expect((await carlos.get('/api/plan')).body).toEqual([]);
    expect(generado.body.avisos.length).toBeGreaterThan(0);
  });
});
