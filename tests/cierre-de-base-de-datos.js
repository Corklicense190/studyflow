// ============================================================
// tests/cierre-de-base-de-datos.js
// Se ejecuta en TODOS los archivos de prueba (setupFilesAfterEnv).
// Al terminar cada archivo cierra las bases de datos en memoria
// (PGlite) que ese archivo haya abierto. Sin esto quedan procesos
// de Node con recursos abiertos y Jest avisa "A worker process has
// failed to exit gracefully".
//
// db/database.js deja en globalThis una lista de funciones de cierre
// solo cuando corre en modo de pruebas; los archivos que no cargan la
// base de datos (como las pruebas del algoritmo) no tienen nada que cerrar.
// ============================================================

afterAll(async () => {
  const cierres = globalThis.__cierresDeBaseDeDatosDePruebas || [];

  await Promise.allSettled(cierres.map(cerrar => cerrar()));
  globalThis.__cierresDeBaseDeDatosDePruebas = [];
});
