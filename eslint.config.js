// ============================================================
// eslint.config.js
// Configuracion "flat config" (formato que usa ESLint 9+).
// eslint-plugin-security es el SAST decidido en el CLAUDE.md:
// analiza el codigo PROPIO buscando patrones peligrosos (eval,
// regex vulnerables a ReDoS, rutas de archivo no confiables, etc.).
// ============================================================

const security = require('eslint-plugin-security');

module.exports = [
  security.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
  {
    // Los archivos de prueba usan las globals que inyecta Jest
    // (describe/test/expect) al correr, no en tiempo de lint.
    files: ['**/*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
      },
    },
    rules: {
      // Falso positivo conocido de esta regla: se dispara con
      // cualquier acceso dinamico a un arreglo/objeto (ej.
      // arreglo[i - 1] dentro de un for), aunque el indice venga
      // de un contador de loop y no de entrada de usuario. Los
      // datos de estas pruebas son fixtures fijos en el codigo,
      // nunca input externo, asi que aqui no aplica.
      'security/detect-object-injection': 'off',
    },
  },
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
];
