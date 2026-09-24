// ============================================================
// tests/despliegue.test.js
// Comportamiento de la app en PRODUCCIÓN (detrás del proxy de
// Railway): falla cerrado sin secreto, y emite la cookie de sesión
// con el atributo Secure cuando el proxy avisa que la conexión
// original era HTTPS.
// ============================================================

const request = require('supertest');

// En producción bcrypt usa costo 12 (~0.25 s por contraseña) y estas
// pruebas hacen varias, así que el tiempo por defecto (5 s) no alcanza.
jest.setTimeout(60000);

// Carga una copia NUEVA de la app con las variables de entorno dadas
// (la configuración se lee al cargar el módulo, por eso hay que
// recargarlo) y restaura el entorno después.
function cargarApp(entorno) {
  const respaldo = { ...process.env };
  Object.assign(process.env, entorno);
  for (const clave of Object.keys(entorno)) {
    if (entorno[clave] === undefined) delete process.env[clave];
  }

  try {
    let app;
    jest.isolateModules(() => {
      app = require('../app');
    });
    return app;
  } finally {
    process.env = respaldo;
  }
}

describe('Arranque en producción', () => {
  test('sin SESSION_SECRET el servidor NO arranca', () => {
    expect(() => cargarApp({ NODE_ENV: 'production', SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET/);
  });

  test('con un SESSION_SECRET corto tampoco arranca', () => {
    expect(() => cargarApp({ NODE_ENV: 'production', SESSION_SECRET: 'corto' })).toThrow(/32 caracteres/);
  });

  test('con un secreto de 32+ caracteres sí arranca', () => {
    expect(() => cargarApp({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40) })).not.toThrow();
  });
});

describe('Detrás del proxy HTTPS de Railway', () => {
  const entornoProduccion = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'un-secreto-largo-de-prueba-para-produccion-1234567890',
    COOKIE_SEGURA: 'true',
    TRUST_PROXY: '1',
  };

  test('la cookie de sesión sale con Secure, HttpOnly y SameSite=Strict', async () => {
    const app = cargarApp(entornoProduccion);

    const respuesta = await request(app)
      .post('/api/auth/registro')
      // Lo que agrega el proxy de Railway al reenviar una petición HTTPS.
      .set('X-Forwarded-Proto', 'https')
      .send({ nombre_usuario: 'en_produccion', password: 'una-contrasena-larga-1' });

    expect(respuesta.status).toBe(201);

    const cookie = respuesta.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  test('el límite de intentos usa la IP real del visitante (X-Forwarded-For), no la del proxy', async () => {
    const app = cargarApp(entornoProduccion);
    const intento = (ip) => request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-For', ip)
      .send({ nombre_usuario: 'nadie', password: 'incorrecta-123' });

    // Un atacante desde 203.0.113.9 agota su cupo (10 fallos)...
    let ultimo;
    for (let i = 0; i < 11; i++) ultimo = await intento('203.0.113.9');
    expect(ultimo.status).toBe(429);

    // ...pero otro visitante distinto, tras el mismo proxy, NO queda bloqueado.
    expect((await intento('198.51.100.7')).status).toBe(401);
  });
});
