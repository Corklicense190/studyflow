# Despliegue de StudyFlow en Railway

StudyFlow guarda todo (cuentas, sesiones, entregables) en un archivo SQLite, así que necesita un **disco persistente**. Railway lo ofrece con *volúmenes*. Por eso se eligió Railway y no una plataforma serverless (como Vercel), cuyo disco no persiste, ni el plan gratuito de Render, cuyo disco se borra en cada reinicio.

## Requisitos previos

- El código en GitHub (`Corklicense190/studyflow`) con el pipeline de CI en verde.
- Una cuenta en [railway.com](https://railway.com) (se puede entrar con GitHub). Los planes y límites cambian: revisa lo vigente en su página de precios antes de empezar.

## Pasos

1. **Crear el proyecto.** En Railway: *New Project* → *Deploy from GitHub repo* → elegir `studyflow`. Railway detecta Node.js, instala las dependencias y usa la configuración de `railway.json` (comando de arranque y *health check* en `/api/status`).

2. **Adjuntar un volumen** al servicio (menú del proyecto → *Volume*, o clic derecho en el lienzo). Punto de montaje: `/data`.

3. **Definir las variables** (pestaña *Variables* del servicio). Nunca se escriben en el repositorio.

   | Variable | Valor | Para qué |
   |---|---|---|
   | `NODE_ENV` | `production` | Activa el modo producción; el servidor **no arranca** sin un secreto de sesión fuerte |
   | `SESSION_SECRET` | una cadena aleatoria de 32+ caracteres | Firma la cookie de sesión |
   | `COOKIE_SEGURA` | `true` | La cookie de sesión solo viaja por HTTPS |
   | `TRUST_PROXY` | `1` | Confía en el proxy de Railway (IP real del visitante y detección de HTTPS) |
   | `DB_PATH` | `/data/studyflow.db` | La base de datos vive dentro del volumen |
   | `RAILWAY_RUN_UID` | `0` | Permite escribir en el volumen (Railway lo monta como root) |

   Para generar el `SESSION_SECRET`, en tu terminal:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   `PORT` lo define Railway solo.

4. **Generar el dominio público.** Servicio → *Settings* → *Networking* → *Generate Domain*. Queda con HTTPS.

## Verificar que quedó bien

1. Abrir la URL: debe aparecer la pantalla de inicio de sesión.
2. Crear una cuenta, agregar un entregable y generar el horario.
3. **Prueba de persistencia:** en Railway, *Redeploy* del servicio. Al volver a entrar con la misma cuenta, los datos deben seguir ahí. Si desaparecen, el volumen o `DB_PATH` no quedaron bien configurados.
4. Revisar los headers de seguridad:

   ```bash
   curl -I https://TU-DOMINIO.up.railway.app/
   ```

   Deben aparecer `strict-transport-security`, `content-security-policy` y `x-content-type-options`.

## Despliegue continuo

Cada Pull Request que se fusiona en `main` (y que ya pasó el CI de GitHub Actions) redespliega la aplicación automáticamente. Si tu plan de Railway lo permite, activa la opción de esperar a que pasen los checks de GitHub antes de desplegar.

## Notas de seguridad

- El `SESSION_SECRET` solo existe como variable en Railway. Si se cambia, todas las sesiones abiertas se cierran (los usuarios vuelven a iniciar sesión; no se pierden datos).
- Las contraseñas se guardan únicamente como hash bcrypt; ni quien administra el servidor puede leerlas.
- El CSS se sirve precompilado desde el repositorio (`public/css/tailwind.css`); el CI verifica que esté al día para no desplegar uno desactualizado.
- Si alguna vez se necesita empezar de cero, basta con borrar el archivo `studyflow.db` del volumen.
