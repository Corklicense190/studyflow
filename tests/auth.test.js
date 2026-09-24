// ============================================================
// tests/auth.test.js
// Pruebas de INTEGRACIÓN de seguridad: usan la app Express
// completa (supertest, sin abrir puerto) contra una base de datos
// en memoria, así que no tocan studyflow.db.
//
// Cubren lo que un revisor de seguridad preguntaría:
//   - ¿Se puede entrar a los datos sin sesión?   -> 401
//   - ¿Se guarda la contraseña en claro?         -> no, hash bcrypt
//   - ¿Un usuario puede ver o tocar datos de otro (IDOR)? -> no
//   - ¿Se puede falsificar el dueño desde el body? -> no
//   - ¿Sirve CSRF desde otro origen?             -> 403
//   - ¿Hay límite contra fuerza bruta?           -> 429
// ============================================================

// Estas variables tienen que ponerse ANTES de cargar la app, porque
// db/database.js y app.js las leen al cargarse. (La base de datos en
// las pruebas es Postgres EN MEMORIA, ver db/database.js.)
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'secreto-de-prueba-solo-para-jest';

const request = require('supertest');
const app = require('../app');
const db = require('../db/database');

const PASSWORD = 'una-contrasena-larga-1';

function diasDesdeHoy(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

// Crea una cuenta y deja el "agente" (que guarda cookies como un
// navegador) con la sesión iniciada.
async function registrar(nombre) {
  const agente = request.agent(app);
  const respuesta = await agente.post('/api/auth/registro').send({ nombre_usuario: nombre, password: PASSWORD });
  expect(respuesta.status).toBe(201);
  return { agente, id: respuesta.body.usuario.id };
}

const entregableValido = () => ({
  materia: 'Redes',
  tipo: 'examen',
  fecha_limite: diasDesdeHoy(5),
  duracion_estimada: 3,
});

describe('Sin sesión, la API de datos está cerrada', () => {
  test.each([
    ['GET', '/api/entregables'],
    ['POST', '/api/entregables'],
    ['PUT', '/api/entregables/1'],
    ['DELETE', '/api/entregables/1'],
    ['GET', '/api/horarios-fijos'],
    ['POST', '/api/horarios-fijos'],
    ['GET', '/api/plan'],
    ['POST', '/api/plan/generar'],
    ['GET', '/api/configuracion'],
    ['PUT', '/api/configuracion'],
    ['GET', '/api/auth/me'],
  ])('%s %s responde 401', async (metodo, ruta) => {
    const respuesta = await request(app)[metodo.toLowerCase()](ruta).send({});
    expect(respuesta.status).toBe(401);
  });

  test('las rutas públicas sí responden', async () => {
    expect((await request(app).get('/api/status')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
  });
});

describe('Registro', () => {
  test('crea la cuenta, abre sesión con cookie httpOnly + SameSite=Strict y no devuelve datos sensibles', async () => {
    const agente = request.agent(app);
    const respuesta = await agente.post('/api/auth/registro').send({ nombre_usuario: 'andre', password: PASSWORD });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.usuario.nombre_usuario).toBe('andre');
    expect(JSON.stringify(respuesta.body)).not.toMatch(/password|hash/i);

    const cookie = respuesta.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/studyflow\.sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    // Cookie "de sesión del navegador": sin fecha de vencimiento, no se guarda en disco.
    expect(cookie).not.toMatch(/Max-Age|Expires/i);

    const yo = await agente.get('/api/auth/me');
    expect(yo.status).toBe(200);
    expect(yo.body.usuario.nombre_usuario).toBe('andre');
  });

  test('la contraseña se guarda como hash bcrypt, nunca en claro', async () => {
    const fila = await db.consultarUna('SELECT password_hash FROM usuarios WHERE nombre_normalizado = $1', ['andre']);

    expect(fila.password_hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(fila.password_hash).not.toContain(PASSWORD);
  });

  test('rechaza un nombre repetido, sin distinguir mayúsculas (409)', async () => {
    const respuesta = await request(app).post('/api/auth/registro').send({ nombre_usuario: 'ANDRE', password: PASSWORD });
    expect(respuesta.status).toBe(409);
  });

  test.each([
    ['contraseña corta', { nombre_usuario: 'usuario1', password: 'corta' }],
    ['contraseña de más de 72 bytes', { nombre_usuario: 'usuario2', password: 'x'.repeat(73) }],
    ['usuario con caracteres raros', { nombre_usuario: '<script>', password: PASSWORD }],
    ['usuario demasiado corto', { nombre_usuario: 'ab', password: PASSWORD }],
    ['sin datos', {}],
  ])('rechaza %s (400)', async (_descripcion, datos) => {
    const respuesta = await request(app).post('/api/auth/registro').send(datos);
    expect(respuesta.status).toBe(400);
  });
});

describe('Login y logout', () => {
  test('con credenciales correctas entra', async () => {
    const respuesta = await request(app).post('/api/auth/login').send({ nombre_usuario: 'andre', password: PASSWORD });
    expect(respuesta.status).toBe(200);
  });

  test('el nombre de usuario no distingue mayúsculas al entrar', async () => {
    const respuesta = await request(app).post('/api/auth/login').send({ nombre_usuario: 'AnDre', password: PASSWORD });
    expect(respuesta.status).toBe(200);
  });

  test('contraseña incorrecta y usuario inexistente dan el MISMO error (no revela cuáles usuarios existen)', async () => {
    const malaPassword = await request(app).post('/api/auth/login').send({ nombre_usuario: 'andre', password: 'incorrecta-123' });
    const noExiste = await request(app).post('/api/auth/login').send({ nombre_usuario: 'fantasma', password: 'incorrecta-123' });

    expect(malaPassword.status).toBe(401);
    expect(noExiste.status).toBe(401);
    expect(malaPassword.body).toEqual(noExiste.body);
  });

  test('el id de sesión cambia al iniciar sesión (previene fijación de sesión)', async () => {
    const agente = request.agent(app);
    const primera = await agente.post('/api/auth/login').send({ nombre_usuario: 'andre', password: PASSWORD });
    const sidPrimera = primera.headers['set-cookie'][0].split(';')[0];

    const segunda = await agente.post('/api/auth/login').send({ nombre_usuario: 'andre', password: PASSWORD });
    const sidSegunda = segunda.headers['set-cookie'][0].split(';')[0];

    expect(sidSegunda).not.toBe(sidPrimera);
  });

  test('logout destruye la sesión en el servidor', async () => {
    const { agente } = await registrar('sale_pronto');
    expect((await agente.get('/api/entregables')).status).toBe(200);

    expect((await agente.post('/api/auth/logout')).status).toBe(200);

    expect((await agente.get('/api/auth/me')).status).toBe(401);
    expect((await agente.get('/api/entregables')).status).toBe(401);
  });
});

describe('Aislamiento de datos entre usuarios (IDOR)', () => {
  let ana;
  let beto;
  let entregableDeAna;
  let horarioDeAna;

  beforeAll(async () => {
    ana = await registrar('ana');
    beto = await registrar('beto');

    entregableDeAna = (await ana.agente.post('/api/entregables').send(entregableValido())).body.id;
    horarioDeAna = (await ana.agente.post('/api/horarios-fijos')
      .send({ dia_semana: 'lunes', hora_inicio: '09:00', hora_fin: '11:00' })).body.id;
  });

  test('cada usuario solo ve sus propios entregables y horarios', async () => {
    expect((await ana.agente.get('/api/entregables')).body).toHaveLength(1);
    expect((await ana.agente.get('/api/horarios-fijos')).body).toHaveLength(1);

    expect((await beto.agente.get('/api/entregables')).body).toEqual([]);
    expect((await beto.agente.get('/api/horarios-fijos')).body).toEqual([]);
  });

  test('otro usuario no puede editar ni borrar un entregable ajeno (404, y sigue intacto)', async () => {
    const editar = await beto.agente.put(`/api/entregables/${entregableDeAna}`).send({ materia: 'Hackeado' });
    const borrar = await beto.agente.delete(`/api/entregables/${entregableDeAna}`);

    expect(editar.status).toBe(404);
    expect(borrar.status).toBe(404);

    const lista = (await ana.agente.get('/api/entregables')).body;
    expect(lista).toHaveLength(1);
    expect(lista[0].materia).toBe('Redes');
  });

  test('otro usuario no puede editar ni borrar un horario ajeno (404, y sigue intacto)', async () => {
    const editar = await beto.agente.put(`/api/horarios-fijos/${horarioDeAna}`).send({ hora_fin: '12:00' });
    const borrar = await beto.agente.delete(`/api/horarios-fijos/${horarioDeAna}`);

    expect(editar.status).toBe(404);
    expect(borrar.status).toBe(404);
    expect((await ana.agente.get('/api/horarios-fijos')).body).toHaveLength(1);
  });

  test('el dueño no se puede falsificar mandando usuario_id en el body', async () => {
    const respuesta = await beto.agente.post('/api/entregables')
      .send({ ...entregableValido(), materia: 'De Beto', usuario_id: ana.id });
    expect(respuesta.status).toBe(201);

    const deAna = (await ana.agente.get('/api/entregables')).body.map(e => e.materia);
    const deBeto = (await beto.agente.get('/api/entregables')).body.map(e => e.materia);

    expect(deAna).not.toContain('De Beto');
    expect(deBeto).toContain('De Beto');
  });

  test('el plan de estudio es privado: generar el de uno no toca ni muestra el de otro', async () => {
    await ana.agente.post('/api/plan/generar');
    const planDeAna = (await ana.agente.get('/api/plan')).body;
    expect(planDeAna.length).toBeGreaterThan(0);
    expect(planDeAna.every(b => b.materia === 'Redes')).toBe(true);

    // Beto tiene su propio entregable pero aún no genera su plan.
    expect((await beto.agente.get('/api/plan')).body).toEqual([]);

    // Al generar el suyo, el de Ana sigue igual.
    await beto.agente.post('/api/plan/generar');
    const otraVezAna = (await ana.agente.get('/api/plan')).body;
    expect(otraVezAna).toEqual(planDeAna);
    expect((await beto.agente.get('/api/plan')).body.every(b => b.materia === 'De Beto')).toBe(true);
  });

  test('la configuración del algoritmo es por usuario', async () => {
    await ana.agente.put('/api/configuracion').send({ limite_horas_dia: 6, ventana_inicio: '09:00' });

    expect((await ana.agente.get('/api/configuracion')).body).toMatchObject({
      limite_horas_dia: 6, ventana_inicio: '09:00', ventana_fin: '22:00',
    });
    expect((await beto.agente.get('/api/configuracion')).body).toMatchObject({
      limite_horas_dia: 4, ventana_inicio: '07:00', ventana_fin: '22:00',
    });
  });
});

describe('Otras defensas', () => {
  test('la sanitización contra XSS sigue funcionando con sesión', async () => {
    const { agente } = await registrar('xss_probador');
    await agente.post('/api/entregables').send({ ...entregableValido(), materia: '<script>alert(1)</script>' });

    const [entregable] = (await agente.get('/api/entregables')).body;
    expect(entregable.materia).not.toContain('<');
    expect(entregable.materia).toContain('&lt;script&gt;');
  });

  test('CSRF: una petición que modifica datos desde otro origen se rechaza aunque traiga la cookie', async () => {
    const { agente } = await registrar('victima');

    const ajeno = await agente.post('/api/entregables').set('Origin', 'http://sitio-malicioso.example').send(entregableValido());
    expect(ajeno.status).toBe(403);

    const propio = await agente.post('/api/entregables').set('Origin', 'http://127.0.0.1').set('Host', '127.0.0.1').send(entregableValido());
    expect(propio.status).toBe(201);
  });

  test('un JSON mal formado da 400 sin filtrar detalles internos', async () => {
    const respuesta = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{no es json');

    expect(respuesta.status).toBe(400);
    expect(JSON.stringify(respuesta.body)).not.toMatch(/at .*\.js|node_modules|stack/i);
  });

  test('fuerza bruta: tras demasiados intentos fallidos el login responde 429', async () => {
    let ultimo;
    for (let i = 0; i < 15; i++) {
      ultimo = await request(app).post('/api/auth/login').send({ nombre_usuario: 'andre', password: `mala-${i}-xxxxx` });
    }
    expect(ultimo.status).toBe(429);
  });
});
