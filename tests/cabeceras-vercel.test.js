// ============================================================
// tests/cabeceras-vercel.test.js
// En Vercel, los archivos de public/ (index.html, css, js) los sirve
// su CDN directamente y NO pasan por Express, así que Helmet no les
// pone sus headers de seguridad. vercel.json los repite para esos
// archivos. Esta prueba garantiza que ambos lados digan LO MISMO: si
// alguien cambia Helmet (o vercel.json) y se desincronizan, falla.
// ============================================================

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../app');

const configuracion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
const reglaEstaticos = configuracion.headers[0];

describe('Headers de seguridad: vercel.json (archivos estáticos) vs Helmet (Express)', () => {
  test('la regla de vercel.json NO aplica a /api (ahí ya responde Helmet)', () => {
    expect(reglaEstaticos.source).toContain('(?!api/)');
  });

  test('cada header de vercel.json es exactamente el que manda Helmet', async () => {
    const respuesta = await request(app).get('/api/status');

    for (const { key, value } of reglaEstaticos.headers) {
      expect([key, respuesta.headers[key.toLowerCase()]]).toEqual([key, value]);
    }
  });

  test('vercel.json cubre los headers de seguridad esenciales', () => {
    const claves = reglaEstaticos.headers.map(h => h.key);

    expect(claves).toEqual(expect.arrayContaining([
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
    ]));
  });

  test('el CSP no permite scripts inline ni eval', () => {
    const csp = reglaEstaticos.headers.find(h => h.key === 'Content-Security-Policy').value;

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
