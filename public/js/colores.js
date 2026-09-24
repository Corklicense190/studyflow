// ============================================================
// public/js/colores.js
// Color elegible para cada tipo de entregable (examen, evidencia,
// tarea). Cada usuario guarda los suyos en la base de datos
// (/api/configuracion), así lo acompañan a cualquier dispositivo.
//
// Cómo funciona: cada tipo tiene una variable CSS (--color-examen...)
// y las clases .tipo-examen / .tipo-evidencia / .tipo-tarea de
// input.css la usan. Cambiar un color es solo cambiar la variable:
// el calendario, la leyenda y la lista se repintan solos, sin volver
// a dibujar nada.
// ============================================================

// Mismos valores por defecto que db/esquema.sql.
const COLORES_POR_DEFECTO = {
  color_examen: '#fb7185',
  color_evidencia: '#818cf8',
  color_tarea: '#fbbf24',
};

// Solo se acepta el formato exacto #rrggbb (el servidor valida lo mismo).
// Aquí se vuelve a comprobar antes de ponerlo en una variable CSS: nunca
// se confía en un valor solo porque "viene de nuestra propia API".
const REGEX_COLOR_HEX = /^#[0-9a-fA-F]{6}$/;

// Luminancia relativa (WCAG): qué tan "claro" se percibe un color.
function luminancia(hex) {
  const canales = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = canales.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Elige texto blanco u oscuro según cuál contraste más con el fondo, para
// que el nombre de la materia se lea aunque el usuario escoja un color
// muy claro (un amarillo pastel) o muy oscuro.
function colorTextoSobre(hex) {
  const l = luminancia(hex);
  const contrasteConBlanco = 1.05 / (l + 0.05);
  const contrasteConOscuro = (l + 0.05) / (0.009 + 0.05);
  return contrasteConBlanco >= contrasteConOscuro ? '#ffffff' : '#111827';
}

function colorValido(valor, respaldo) {
  return typeof valor === 'string' && REGEX_COLOR_HEX.test(valor) ? valor.toLowerCase() : respaldo;
}

// Pone los colores de "config" (la respuesta de /api/configuracion) en
// las variables CSS del documento.
function aplicarColores(config) {
  const tipos = [
    ['examen', colorValido(config.color_examen, COLORES_POR_DEFECTO.color_examen)],
    ['evidencia', colorValido(config.color_evidencia, COLORES_POR_DEFECTO.color_evidencia)],
    ['tarea', colorValido(config.color_tarea, COLORES_POR_DEFECTO.color_tarea)],
  ];

  for (const [tipo, hex] of tipos) {
    document.documentElement.style.setProperty(`--color-${tipo}`, hex);
    document.documentElement.style.setProperty(`--texto-sobre-${tipo}`, colorTextoSobre(hex));
  }
}

function llenarFormularioColores(config) {
  document.getElementById('color-examen').value = colorValido(config.color_examen, COLORES_POR_DEFECTO.color_examen);
  document.getElementById('color-evidencia').value = colorValido(config.color_evidencia, COLORES_POR_DEFECTO.color_evidencia);
  document.getElementById('color-tarea').value = colorValido(config.color_tarea, COLORES_POR_DEFECTO.color_tarea);
}

function leerFormularioColores() {
  return {
    color_examen: document.getElementById('color-examen').value,
    color_evidencia: document.getElementById('color-evidencia').value,
    color_tarea: document.getElementById('color-tarea').value,
  };
}

async function guardarColores(colores) {
  try {
    await api.configuracion.actualizar(colores);
    mostrarToast('exito', 'Colores guardados');
  } catch (error) {
    mostrarToast('error', `No se pudieron guardar los colores: ${error.message}`);
  }
}

async function inicializarColores() {
  const selectores = ['color-examen', 'color-evidencia', 'color-tarea'].map(id => document.getElementById(id));

  for (const selector of selectores) {
    // "input" se dispara MIENTRAS se arrastra en el selector: vista previa
    // al instante, sin guardar. "change" se dispara al confirmar el color:
    // ahí sí se guarda (no hace falta un botón "Guardar").
    selector.addEventListener('input', () => aplicarColores(leerFormularioColores()));
    selector.addEventListener('change', () => guardarColores(leerFormularioColores()));
  }

  document.getElementById('colores-restablecer').addEventListener('click', async () => {
    llenarFormularioColores(COLORES_POR_DEFECTO);
    aplicarColores(COLORES_POR_DEFECTO);
    await guardarColores(COLORES_POR_DEFECTO);
  });

  try {
    const config = await api.configuracion.obtener();
    aplicarColores(config);
    llenarFormularioColores(config);
  } catch (error) {
    mostrarToast('error', `No se pudieron cargar tus colores: ${error.message}`);
  }
}
