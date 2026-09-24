// ============================================================
// tests/perfil.test.js
// Perfil: datos personales, foto, cambio de usuario y de contraseña.
// Lo importante en seguridad: la foto solo acepta imágenes reales
// (nunca SVG ni archivos disfrazados), cambiar usuario o contraseña
// exige la contraseña actual y tiene límite de intentos, y todo
// queda aislado por usuario.
// ============================================================

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'secreto-de-prueba-solo-para-jest';

const request = require('supertest');
const app = require('../app');

const PASSWORD = 'una-contrasena-larga-1';

async function registrar(nombre) {
  // Este archivo crea más de 20 usuarios: se reinicia el contador del límite de
  // registros por IP (20/hora) para que no bloquee a los de la parte final.
  const baseDeDatos = require('../db/database');
  await baseDeDatos.listo; // el esquema ya está aplicado
  await baseDeDatos.ejecutar("DELETE FROM limites_intentos WHERE clave LIKE 'registro:%'");

  const agente = request.agent(app);
  await agente.post('/api/auth/registro').send({ nombre_usuario: nombre, password: PASSWORD });
  return agente;
}

// Cabeceras mínimas reales de cada formato (con la firma correcta al inicio).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(200, 3)]);

const subirFoto = (agente, tipo, cuerpo) => agente.put('/api/perfil/foto').set('Content-Type', tipo).send(cuerpo);

describe('Datos del perfil', () => {
  let ana;
  let beto;

  beforeAll(async () => {
    ana = await registrar('ana_perfil');
    beto = await registrar('beto_perfil');
  });

  test('un perfil nuevo está vacío y sin foto', async () => {
    const respuesta = await ana.get('/api/perfil');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject({
      nombre_usuario: 'ana_perfil', apodo: '', institucion: '', carrera: '', sobre_mi: '', tiene_foto: false,
    });
  });

  test('se guardan los datos personales', async () => {
    const respuesta = await ana.put('/api/perfil')
      .send({ apodo: 'Ani', institucion: 'Tecmilenio', carrera: 'Ingeniería en Sistemas', sobre_mi: 'Me gusta estudiar de noche' });
    expect(respuesta.status).toBe(200);

    expect((await ana.get('/api/perfil')).body).toMatchObject({
      apodo: 'Ani', institucion: 'Tecmilenio', carrera: 'Ingeniería en Sistemas', sobre_mi: 'Me gusta estudiar de noche',
    });
  });

  test('actualizar un solo campo conserva los demás y "" lo borra', async () => {
    await ana.put('/api/perfil').send({ apodo: 'Ani2' });
    let perfil = (await ana.get('/api/perfil')).body;
    expect(perfil).toMatchObject({ apodo: 'Ani2', institucion: 'Tecmilenio' });

    await ana.put('/api/perfil').send({ institucion: '' });
    perfil = (await ana.get('/api/perfil')).body;
    expect(perfil.institucion).toBe('');
    expect(perfil.apodo).toBe('Ani2');
  });

  test('el HTML se guarda escapado (no ejecutable)', async () => {
    await ana.put('/api/perfil').send({ sobre_mi: '<img src=x onerror=alert(1)>' });

    const { sobre_mi } = (await ana.get('/api/perfil')).body;
    expect(sobre_mi).not.toContain('<img');
    expect(sobre_mi).toContain('&lt;img');
  });

  test.each([
    ['apodo', 41], ['institucion', 101], ['carrera', 101], ['sobre_mi', 301],
  ])('rechaza "%s" por encima de su límite', async (campo, largo) => {
    const respuesta = await ana.put('/api/perfil').send({ [campo]: 'a'.repeat(largo) });
    expect(respuesta.status).toBe(400);
  });

  test('rechaza valores que no son texto', async () => {
    const respuesta = await ana.put('/api/perfil').send({ apodo: { $ne: 1 } });
    expect(respuesta.status).toBe(400);
  });

  test('cada usuario ve solo su propio perfil', async () => {
    const perfilDeBeto = (await beto.get('/api/perfil')).body;

    expect(perfilDeBeto.nombre_usuario).toBe('beto_perfil');
    expect(perfilDeBeto.apodo).toBe('');
    expect(JSON.stringify(perfilDeBeto)).not.toContain('Ani');
  });

  test('sin sesión no hay acceso al perfil ni a la foto', async () => {
    for (const [metodo, ruta] of [['get', '/api/perfil'], ['put', '/api/perfil'], ['get', '/api/perfil/foto'],
      ['put', '/api/perfil/foto'], ['delete', '/api/perfil/foto'], ['put', '/api/perfil/password'], ['put', '/api/perfil/usuario']]) {
      const respuesta = await request(app)[metodo](ruta);
      expect(respuesta.status).toBe(401);
    }
  });
});

describe('Foto de perfil', () => {
  let ana;
  let beto;

  beforeAll(async () => {
    ana = await registrar('ana_foto');
    beto = await registrar('beto_foto');
  });

  test('sin foto, GET devuelve 404', async () => {
    expect((await ana.get('/api/perfil/foto')).status).toBe(404);
  });

  test.each([['image/jpeg', JPEG], ['image/png', PNG], ['image/webp', WEBP]])('acepta %s y la devuelve igual', async (tipo, archivo) => {
    const subida = await subirFoto(ana, tipo, archivo);
    expect(subida.status).toBe(200);

    const perfil = (await ana.get('/api/perfil')).body;
    expect(perfil.tiene_foto).toBe(true);
    expect(perfil.foto_version).toBe(subida.body.foto_version);

    const foto = await ana.get('/api/perfil/foto').buffer(true).parse((res, cb) => {
      const trozos = [];
      res.on('data', t => trozos.push(t));
      res.on('end', () => cb(null, Buffer.concat(trozos)));
    });
    expect(foto.status).toBe(200);
    expect(foto.headers['content-type']).toBe(tipo);
    expect(foto.body.equals(archivo)).toBe(true);
  });

  test('la foto se sirve con cabeceras que impiden ejecutar nada', async () => {
    const foto = await ana.get('/api/perfil/foto');

    expect(foto.headers['x-content-type-options']).toBe('nosniff');
    expect(foto.headers['content-security-policy']).toContain("default-src 'none'");
    expect(foto.headers['cache-control']).toContain('private');
  });

  test('rechaza SVG (puede llevar scripts)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const respuesta = await subirFoto(ana, 'image/svg+xml', svg);
    expect(respuesta.status).toBe(415);
  });

  test('rechaza otros tipos (HTML, texto, JSON)', async () => {
    expect((await subirFoto(ana, 'text/html', '<script>alert(1)</script>')).status).toBe(415);
    expect((await subirFoto(ana, 'application/octet-stream', JPEG)).status).toBe(415);
  });

  test('rechaza un archivo disfrazado: dice ser JPEG pero no lo es', async () => {
    const falso = Buffer.from('<html><script>alert(1)</script></html>');
    const respuesta = await subirFoto(ana, 'image/jpeg', falso);
    expect(respuesta.status).toBe(415);
  });

  test('rechaza un tipo que no corresponde a la firma (PNG enviado como JPEG)', async () => {
    expect((await subirFoto(ana, 'image/jpeg', PNG)).status).toBe(415);
    expect((await subirFoto(ana, 'image/png', JPEG)).status).toBe(415);
  });

  test('rechaza una foto de más de 300 KB con 413', async () => {
    const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(301 * 1024, 1)]);
    const respuesta = await subirFoto(ana, 'image/jpeg', grande);
    expect(respuesta.status).toBe(413);
  });

  test('rechaza un cuerpo vacío', async () => {
    const respuesta = await subirFoto(ana, 'image/jpeg', Buffer.alloc(0));
    expect(respuesta.status).toBe(415);
  });

  test('una foto rechazada no reemplaza a la buena', async () => {
    await subirFoto(ana, 'image/png', PNG);
    await subirFoto(ana, 'image/jpeg', Buffer.from('basura'));

    const foto = await ana.get('/api/perfil/foto');
    expect(foto.headers['content-type']).toBe('image/png');
  });

  test('otro usuario no ve mi foto', async () => {
    await subirFoto(ana, 'image/png', PNG);

    expect((await beto.get('/api/perfil/foto')).status).toBe(404);
    expect((await beto.get('/api/perfil')).body.tiene_foto).toBe(false);
  });

  test('la foto nueva cambia la versión (el navegador no usa una vieja en caché)', async () => {
    const primera = (await subirFoto(ana, 'image/png', PNG)).body.foto_version;
    await new Promise(r => setTimeout(r, 5));
    const segunda = (await subirFoto(ana, 'image/png', PNG)).body.foto_version;

    expect(segunda).toBeGreaterThan(primera);
  });

  test('se puede quitar la foto', async () => {
    await subirFoto(ana, 'image/png', PNG);
    const respuesta = await ana.delete('/api/perfil/foto');
    expect(respuesta.status).toBe(200);

    expect((await ana.get('/api/perfil/foto')).status).toBe(404);
    expect((await ana.get('/api/perfil')).body.tiene_foto).toBe(false);
  });
});

describe('Cambiar nombre de usuario', () => {
  test('con la contraseña correcta cambia, y se puede iniciar sesión con el nuevo', async () => {
    const agente = await registrar('cambia_usuario');

    const respuesta = await agente.put('/api/perfil/usuario').send({ nombre_usuario: 'Usuario.Nuevo', password_actual: PASSWORD });
    expect(respuesta.status).toBe(200);

    expect((await agente.get('/api/auth/me')).body.usuario.nombre_usuario).toBe('Usuario.Nuevo');
    expect((await agente.get('/api/perfil')).body.nombre_usuario).toBe('Usuario.Nuevo');

    const login = await request(app).post('/api/auth/login').send({ nombre_usuario: 'usuario.nuevo', password: PASSWORD });
    expect(login.status).toBe(200);

    const viejo = await request(app).post('/api/auth/login').send({ nombre_usuario: 'cambia_usuario', password: PASSWORD });
    expect(viejo.status).toBe(401);
  });

  test('con la contraseña incorrecta responde 403 (no 401) y no cambia nada', async () => {
    const agente = await registrar('no_cambia_usuario');

    const respuesta = await agente.put('/api/perfil/usuario').send({ nombre_usuario: 'otro_nombre', password_actual: 'incorrecta-123' });
    expect(respuesta.status).toBe(403);
    expect((await agente.get('/api/perfil')).body.nombre_usuario).toBe('no_cambia_usuario');
  });

  test('rechaza un nombre ya en uso (sin distinguir mayúsculas) con 409', async () => {
    await registrar('nombre_ocupado');
    const agente = await registrar('quiere_ocupado');

    const respuesta = await agente.put('/api/perfil/usuario').send({ nombre_usuario: 'NOMBRE_OCUPADO', password_actual: PASSWORD });
    expect(respuesta.status).toBe(409);
  });

  test('puede cambiar solo las mayúsculas de su propio nombre', async () => {
    const agente = await registrar('solo_mayusculas');

    const respuesta = await agente.put('/api/perfil/usuario').send({ nombre_usuario: 'Solo_Mayusculas', password_actual: PASSWORD });
    expect(respuesta.status).toBe(200);
  });

  test('exige las mismas reglas que el registro', async () => {
    const agente = await registrar('reglas_usuario');

    for (const nombre of ['ab', 'a'.repeat(31), 'con espacios', 'raro<script>']) {
      const respuesta = await agente.put('/api/perfil/usuario').send({ nombre_usuario: nombre, password_actual: PASSWORD });
      expect(respuesta.status).toBe(400);
    }
  });

  test('tras 5 contraseñas incorrectas bloquea (429), aunque después mande la correcta', async () => {
    const agente = await registrar('bloqueo_usuario');

    for (let i = 0; i < 5; i++) {
      const respuesta = await agente.put('/api/perfil/usuario').send({ nombre_usuario: 'nuevo_nombre', password_actual: 'incorrecta-123' });
      expect(respuesta.status).toBe(403);
    }

    const bloqueado = await agente.put('/api/perfil/usuario').send({ nombre_usuario: 'nuevo_nombre', password_actual: PASSWORD });
    expect(bloqueado.status).toBe(429);
  });
});

describe('Cambiar contraseña', () => {
  test('con la actual correcta cambia: la nueva sirve y la vieja no', async () => {
    const agente = await registrar('cambia_password');

    const respuesta = await agente.put('/api/perfil/password').send({ password_actual: PASSWORD, password_nueva: 'otra-contrasena-larga-2' });
    expect(respuesta.status).toBe(200);

    expect((await request(app).post('/api/auth/login').send({ nombre_usuario: 'cambia_password', password: 'otra-contrasena-larga-2' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ nombre_usuario: 'cambia_password', password: PASSWORD })).status).toBe(401);
  });

  test('la sesión actual sigue activa (con id nuevo) y las otras se cierran', async () => {
    const principal = await registrar('cierra_otras');
    const otroDispositivo = request.agent(app);
    await otroDispositivo.post('/api/auth/login').send({ nombre_usuario: 'cierra_otras', password: PASSWORD });
    expect((await otroDispositivo.get('/api/auth/me')).status).toBe(200);

    const cambio = await principal.put('/api/perfil/password').send({ password_actual: PASSWORD, password_nueva: 'otra-contrasena-larga-2' });
    expect(cambio.status).toBe(200);

    expect((await principal.get('/api/auth/me')).status).toBe(200);
    expect((await otroDispositivo.get('/api/auth/me')).status).toBe(401);
  });

  test('la sesión de OTRO usuario no se cierra', async () => {
    const carlos = await registrar('carlos_intacto');
    const dora = await registrar('dora_cambia');

    await dora.put('/api/perfil/password').send({ password_actual: PASSWORD, password_nueva: 'otra-contrasena-larga-2' });

    expect((await carlos.get('/api/auth/me')).status).toBe(200);
  });

  test('con la actual incorrecta responde 403 y no cambia nada', async () => {
    const agente = await registrar('no_cambia_password');

    const respuesta = await agente.put('/api/perfil/password').send({ password_actual: 'incorrecta-123', password_nueva: 'otra-contrasena-larga-2' });
    expect(respuesta.status).toBe(403);
    expect((await request(app).post('/api/auth/login').send({ nombre_usuario: 'no_cambia_password', password: PASSWORD })).status).toBe(200);
  });

  test('la nueva debe cumplir las reglas y ser distinta de la actual', async () => {
    const agente = await registrar('reglas_password');

    const corta = await agente.put('/api/perfil/password').send({ password_actual: PASSWORD, password_nueva: 'corta' });
    const larga = await agente.put('/api/perfil/password').send({ password_actual: PASSWORD, password_nueva: 'a'.repeat(73) });
    const igual = await agente.put('/api/perfil/password').send({ password_actual: PASSWORD, password_nueva: PASSWORD });

    expect(corta.status).toBe(400);
    expect(larga.status).toBe(400);
    expect(igual.status).toBe(400);
  });

  test('la contraseña nueva se guarda solo como hash', async () => {
    const agente = await registrar('hash_password');
    await agente.put('/api/perfil/password').send({ password_actual: PASSWORD, password_nueva: 'otra-contrasena-larga-2' });

    const db = require('../db/database');
    const fila = await db.consultarUna('SELECT password_hash FROM usuarios WHERE nombre_normalizado = $1', ['hash_password']);
    expect(fila.password_hash).toMatch(/^\$2[aby]\$/);
    expect(fila.password_hash).not.toContain('otra-contrasena');
  });

  test('tras 5 intentos con la contraseña actual incorrecta bloquea (429)', async () => {
    const agente = await registrar('bloqueo_password');

    for (let i = 0; i < 5; i++) {
      const respuesta = await agente.put('/api/perfil/password').send({ password_actual: 'incorrecta-123', password_nueva: 'otra-contrasena-larga-2' });
      expect(respuesta.status).toBe(403);
    }

    const bloqueado = await agente.put('/api/perfil/password').send({ password_actual: PASSWORD, password_nueva: 'otra-contrasena-larga-2' });
    expect(bloqueado.status).toBe(429);
  });
});

describe('Eliminar la cuenta', () => {
  const db = require('../db/database');

  const eliminar = (agente, datos) => agente.delete('/api/perfil/cuenta').send(datos);

  test('sin contraseña o sin confirmación responde 400 y no borra nada', async () => {
    const agente = await registrar('borra_400');

    expect((await eliminar(agente, { confirmacion: 'borra_400' })).status).toBe(400);
    expect((await eliminar(agente, { password_actual: PASSWORD })).status).toBe(400);
    expect((await agente.get('/api/auth/me')).status).toBe(200);
  });

  test('con la contraseña incorrecta responde 403 y la cuenta sigue existiendo', async () => {
    const agente = await registrar('borra_403');

    const respuesta = await eliminar(agente, { password_actual: 'incorrecta-123', confirmacion: 'borra_403' });
    expect(respuesta.status).toBe(403);
    expect((await request(app).post('/api/auth/login').send({ nombre_usuario: 'borra_403', password: PASSWORD })).status).toBe(200);
  });

  test('si el nombre escrito no coincide exactamente, no borra', async () => {
    const agente = await registrar('Borra_Nombre');

    for (const confirmacion of ['borra_nombre', 'Borra_Nombre ', 'otro', '']) {
      const respuesta = await eliminar(agente, { password_actual: PASSWORD, confirmacion });
      expect(respuesta.status).toBe(400);
    }
    expect((await agente.get('/api/auth/me')).status).toBe(200);
  });

  test('con contraseña y nombre correctos elimina la cuenta y cierra la sesión', async () => {
    const agente = await registrar('borra_ok');

    const respuesta = await eliminar(agente, { password_actual: PASSWORD, confirmacion: 'borra_ok' });
    expect(respuesta.status).toBe(200);

    expect((await agente.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ nombre_usuario: 'borra_ok', password: PASSWORD })).status).toBe(401);
  });

  test('borra TODOS sus datos: entregables, bloques, horarios, configuración, perfil y foto', async () => {
    const agente = await registrar('borra_todo');
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + 5);

    await agente.put('/api/perfil').send({ apodo: 'Borrable' });
    await subirFoto(agente, 'image/png', PNG);
    await agente.post('/api/horarios-fijos').send({ dias_semana: ['lunes', 'martes'], hora_inicio: '08:00', hora_fin: '09:00' });
    await agente.post('/api/entregables').send({ materia: 'Borrable', tipo: 'examen', fecha_limite: fecha.toISOString().slice(0, 10), duracion_estimada: 2 });
    await agente.post('/api/plan/generar');

    const { id } = await db.consultarUna('SELECT id FROM usuarios WHERE nombre_normalizado = $1', ['borra_todo']);

    expect((await eliminar(agente, { password_actual: PASSWORD, confirmacion: 'borra_todo' })).status).toBe(200);

    for (const tabla of ['entregables', 'horarios_fijos', 'configuracion', 'perfiles']) {
      const { total } = await db.consultarUna(`SELECT COUNT(*)::int AS total FROM ${tabla} WHERE usuario_id = $1`, [id]);
      expect(total).toBe(0);
    }
    const bloques = await db.consultarUna('SELECT COUNT(*)::int AS total FROM bloques_estudio b LEFT JOIN entregables e ON e.id = b.entregable_id WHERE e.id IS NULL');
    expect(bloques.total).toBe(0);
    expect((await db.consultarUna('SELECT COUNT(*)::int AS total FROM usuarios WHERE id = $1', [id])).total).toBe(0);
  });

  test('cierra también las sesiones de esa cuenta en otros dispositivos', async () => {
    const principal = await registrar('borra_sesiones');
    const otro = request.agent(app);
    await otro.post('/api/auth/login').send({ nombre_usuario: 'borra_sesiones', password: PASSWORD });
    expect((await otro.get('/api/auth/me')).status).toBe(200);

    await eliminar(principal, { password_actual: PASSWORD, confirmacion: 'borra_sesiones' });

    expect((await otro.get('/api/auth/me')).status).toBe(401);
    const { total } = await db.consultarUna(`SELECT COUNT(*)::int AS total FROM sesiones WHERE (datos::jsonb ->> 'usuarioId') IS NOT NULL AND datos LIKE '%"nombreUsuario":"borra_sesiones"%'`);
    expect(total).toBe(0);
  });

  test('no afecta a otros usuarios', async () => {
    const intacto = await registrar('borra_intacto');
    await intacto.put('/api/perfil').send({ apodo: 'Sigo aquí' });
    const borrado = await registrar('borra_vecino');

    await eliminar(borrado, { password_actual: PASSWORD, confirmacion: 'borra_vecino' });

    expect((await intacto.get('/api/auth/me')).status).toBe(200);
    expect((await intacto.get('/api/perfil')).body.apodo).toBe('Sigo aquí');
  });

  test('el nombre de usuario queda libre para volver a registrarse', async () => {
    const agente = await registrar('borra_y_vuelve');
    await eliminar(agente, { password_actual: PASSWORD, confirmacion: 'borra_y_vuelve' });

    const nuevo = await request(app).post('/api/auth/registro').send({ nombre_usuario: 'borra_y_vuelve', password: PASSWORD });
    expect(nuevo.status).toBe(201);
  });

  test('sin sesión responde 401', async () => {
    const respuesta = await request(app).delete('/api/perfil/cuenta').send({ password_actual: PASSWORD, confirmacion: 'x' });
    expect(respuesta.status).toBe(401);
  });

  test('tras 5 contraseñas incorrectas bloquea (429), aunque después mande la correcta', async () => {
    const agente = await registrar('borra_bloqueo');

    for (let i = 0; i < 5; i++) {
      expect((await eliminar(agente, { password_actual: 'incorrecta-123', confirmacion: 'borra_bloqueo' })).status).toBe(403);
    }

    expect((await eliminar(agente, { password_actual: PASSWORD, confirmacion: 'borra_bloqueo' })).status).toBe(429);
    expect((await agente.get('/api/auth/me')).status).toBe(200);
  });

  test('una petición de otro origen (CSRF) no puede borrar la cuenta', async () => {
    const agente = await registrar('borra_csrf');

    const respuesta = await agente.delete('/api/perfil/cuenta')
      .set('Origin', 'https://sitio-malicioso.example')
      .send({ password_actual: PASSWORD, confirmacion: 'borra_csrf' });

    expect(respuesta.status).toBe(403);
    expect((await agente.get('/api/auth/me')).status).toBe(200);
  });
});

describe('Protección CSRF en el perfil', () => {
  test('rechaza un cambio de contraseña que viene de otro origen', async () => {
    const agente = await registrar('csrf_perfil');

    const respuesta = await agente.put('/api/perfil/password')
      .set('Origin', 'https://sitio-malicioso.example')
      .send({ password_actual: PASSWORD, password_nueva: 'otra-contrasena-larga-2' });

    expect(respuesta.status).toBe(403);
    expect((await request(app).post('/api/auth/login').send({ nombre_usuario: 'csrf_perfil', password: PASSWORD })).status).toBe(200);
  });
});
