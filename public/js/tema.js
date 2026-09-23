// ============================================================
// public/js/tema.js
// Modo claro/oscuro + acento pastel. Se carga en <head> SIN defer
// a propósito: así los atributos data-modo / data-tema quedan
// puestos en <html> antes de que el navegador pinte nada y no hay
// un parpadeo del tema equivocado al recargar. Es un archivo
// externo (no un <script> inline) porque el CSP de Helmet solo
// permite scripts del mismo origen.
//
// La preferencia se guarda en localStorage. Es solo una
// comodidad de interfaz (no son datos de la app), y si el
// navegador lo bloquea (modo privado) simplemente no se recuerda.
// ============================================================

(function () {
  const CLAVE_MODO = 'studyflow-modo';
  const CLAVE_TEMA = 'studyflow-tema';
  const MODOS = ['claro', 'oscuro'];
  const TEMAS = ['cielo', 'lavanda', 'menta', 'durazno'];

  function leer(clave) {
    try { return localStorage.getItem(clave); } catch { return null; }
  }

  function guardar(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento: solo no se recuerda */ }
  }

  // Lo guardado se valida contra la lista de valores permitidos
  // antes de usarlo, así nada raro de localStorage llega al DOM.
  let modo = leer(CLAVE_MODO);
  if (!MODOS.includes(modo)) {
    modo = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  }

  let tema = leer(CLAVE_TEMA);
  if (!TEMAS.includes(tema)) tema = 'cielo';

  function aplicar() {
    document.documentElement.setAttribute('data-modo', modo);
    document.documentElement.setAttribute('data-tema', tema);

    const botonModo = document.getElementById('boton-modo');
    if (botonModo) {
      // El texto dice a qué modo vas a CAMBIAR, no en cuál estás.
      botonModo.textContent = modo === 'oscuro' ? 'Modo claro' : 'Modo oscuro';
    }

    document.querySelectorAll('[data-tema-btn]').forEach(boton => {
      boton.setAttribute('aria-pressed', boton.dataset.temaBtn === tema ? 'true' : 'false');
    });
  }

  aplicar(); // antes del primer pintado

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('boton-modo').addEventListener('click', () => {
      modo = modo === 'oscuro' ? 'claro' : 'oscuro';
      guardar(CLAVE_MODO, modo);
      aplicar();
    });

    document.querySelectorAll('[data-tema-btn]').forEach(boton => {
      boton.addEventListener('click', () => {
        tema = boton.dataset.temaBtn;
        guardar(CLAVE_TEMA, tema);
        aplicar();
      });
    });

    aplicar(); // ahora que los botones ya existen en el DOM
  });
})();
