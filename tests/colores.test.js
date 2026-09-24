// ============================================================
// tests/colores.test.js
// Color elegible por tipo de entregable (guardado por usuario).
// Lo más importante en seguridad: el valor termina dentro de una
// variable CSS en el navegador, así que solo se acepta el formato
// exacto "#rrggbb"; cualquier otra cosa se rechaza.
// ============================================================

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'secreto-de-prueba-solo-para-jest';

const request = require('supertest');
const app = require('../app');

const PASSWORD = 'una-contrasena-larga-1';
const COLORES_ORIGINALES = { color_examen: '#fb7185', color_evidencia: '#818cf8', color_tarea: '#fbbf24' };

async function registrar(nombre) {
  const agente = request.agent(app);
  await agente.post('/api/auth/registro').send({ nombre_usuario: nombre, password: PASSWORD });
  return agente;
}

describe('Colores por tipo de entregable', () => {
  let ana;
  let beto;

  beforeAll(async () => {
    ana = await registrar('ana_colores');
    beto = await registrar('beto_colores');
  });

  test('una cuenta nueva empieza con los colores originales de la app', async () => {
    const respuesta = await ana.get('/api/configuracion');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject(COLORES_ORIGINALES);
  });

  test('se puede cambiar un solo color sin tocar los demás', async () => {
    const respuesta = await ana.put('/api/configuracion').send({ color_tarea: '#10b981' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.configuracion).toMatchObject({
      color_examen: '#fb7185', color_evidencia: '#818cf8', color_tarea: '#10b981',
    });
  });

  test('se guardan en minúsculas aunque lleguen en mayúsculas', async () => {
    const respuesta = await ana.put('/api/configuracion').send({ color_examen: '#AABBCC' });

    expect(respuesta.body.configuracion.color_examen).toBe('#aabbcc');
  });

  test('cambiar colores no toca el límite diario ni la ventana horaria', async () => {
    const antes = (await ana.get('/api/configuracion')).body;
    await ana.put('/api/configuracion').send({ color_evidencia: '#123456' });
    const despues = (await ana.get('/api/configuracion')).body;

    expect(despues).toMatchObject({
      limite_horas_dia: antes.limite_horas_dia,
      ventana_inicio: antes.ventana_inicio,
      ventana_fin: antes.ventana_fin,
    });
  });

  test('los colores son por usuario: lo que elige uno no lo ve el otro', async () => {
    await ana.put('/api/configuracion').send({ color_examen: '#000000' });

    expect((await beto.get('/api/configuracion')).body).toMatchObject(COLORES_ORIGINALES);
  });

  test.each([
    ['un nombre de color', 'red'],
    ['hexadecimal corto', '#fff'],
    ['sin almohadilla', 'fb7185'],
    ['caracteres no hexadecimales', '#gggggg'],
    ['demasiado largo', '#fb718500'],
    ['rgb()', 'rgb(1,2,3)'],
    ['un intento de inyectar CSS', '#fb7185;background:url(https://malo.example/x)'],
    ['un intento de cerrar la variable', 'red}body{display:none'],
    ['vacío', ''],
  ])('rechaza %s (400)', async (_descripcion, valor) => {
    const respuesta = await ana.put('/api/configuracion').send({ color_tarea: valor });

    expect(respuesta.status).toBe(400);
  });

  test('un color rechazado no se guarda', async () => {
    await ana.put('/api/configuracion').send({ color_tarea: 'red}body{display:none' });

    const { color_tarea } = (await ana.get('/api/configuracion')).body;
    expect(color_tarea).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('sin sesión no se pueden ver ni cambiar', async () => {
    expect((await request(app).get('/api/configuracion')).status).toBe(401);
    expect((await request(app).put('/api/configuracion').send({ color_tarea: '#000000' })).status).toBe(401);
  });
});
