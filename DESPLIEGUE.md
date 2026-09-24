# Despliegue de StudyFlow: Vercel + Supabase

- **Supabase** aloja la base de datos (PostgreSQL).
- **Vercel** aloja la aplicación: el frontend (`public/`) lo sirve su CDN y la API de Express corre como una función serverless.

Como en serverless la memoria y el disco no se comparten entre peticiones, **todo el estado vive en Postgres**: cuentas, entregables, horarios, las **sesiones** (`db/almacen-sesiones.js`) y los **contadores del límite de intentos de login** (`db/almacen-limites.js`).

## 1. Supabase (base de datos)

1. Crea un proyecto en [supabase.com](https://supabase.com). Elige una región cercana a la de tus funciones de Vercel (por defecto `iad1`, este de EE. UU.) y guarda la contraseña de la base de datos.
2. **Crear las tablas.** En el **SQL Editor**, pega el contenido de [`db/esquema.sql`](db/esquema.sql) y ejecútalo (*Run*).
   **Al actualizar la aplicación:** cuando una versión nueva agrega columnas o tablas, `db/esquema.sql` las incluye (con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). Vuelve a correr el archivo completo en el SQL Editor **ANTES de desplegar** la versión nueva: es seguro repetirlo, no borra ni cambia datos. Si se despliega primero, las rutas que usan la columna nueva responden error 500 hasta que se aplique. (La versión con colores por tipo agrega `color_examen`, `color_evidencia` y `color_tarea` a `configuracion`.)
3. **Cerrar el acceso público a las tablas.** En el mismo editor ejecuta [`db/supabase-seguridad.sql`](db/supabase-seguridad.sql). Supabase publica por defecto las tablas mediante una API REST protegida solo por la llave `anon` (pública por diseño). StudyFlow no usa esa API, así que se bloquea (RLS activado sin políticas + permisos revocados). **No te saltes este paso**: sin él, cualquiera con la llave `anon` podría leer la tabla de usuarios.
4. **Cadena de conexión.** Botón *Connect* → **Transaction pooler** (puerto **6543**, el que sirve para serverless). Cópiala y sustituye `[YOUR-PASSWORD]`. Este pooler no admite sentencias preparadas; el driver `pg` que usamos no las necesita.
5. **Certificado para verificar el servidor.** *Database Settings* → *SSL Configuration* → descarga el certificado (`.crt`). Su contenido va en la variable `DATABASE_CA`. Sin él la conexión va cifrada pero no se verifica la identidad del servidor.

## 2. Vercel (aplicación)

1. *Add New… → Project* → importa el repositorio de GitHub.
2. *Framework Preset*: **Other**. Deja vacíos los comandos de build (el CSS ya viene compilado en `public/css/tailwind.css`).
3. **Variables de entorno** (*Settings → Environment Variables*). Nunca se escriben en el repositorio:

   | Variable | Valor | Para qué |
   |---|---|---|
   | `DATABASE_URL` | la cadena del *Transaction pooler* | Conexión a Supabase (sin `?sslmode=`) |
   | `DATABASE_CA` | contenido del certificado `.crt` | Verifica el certificado de la base de datos |
   | `SESSION_SECRET` | cadena aleatoria de 32+ caracteres | Firma la cookie de sesión (sin él el servidor **no arranca** en producción) |
   | `COOKIE_SEGURA` | `true` | La cookie de sesión solo viaja por HTTPS |
   | `TRUST_PROXY` | `1` | Confía en el proxy de Vercel (IP real del visitante y detección de HTTPS) |

   `NODE_ENV=production` lo define Vercel solo. Para generar el `SESSION_SECRET`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. *Deploy*. Vercel detecta `app.js` (que exporta la app de Express) y usa Node 22 (`engines` en `package.json`).

## 3. Verificar que quedó bien

1. Abre la URL: debe aparecer la pantalla de inicio de sesión. Crea una cuenta, agrega un entregable y genera el horario.
2. **Persistencia:** haz *Redeploy* y entra otra vez: los datos deben seguir ahí.
3. **Headers de seguridad en los archivos estáticos** (los sirve la CDN, no Express; por eso están repetidos en `vercel.json`):

   ```bash
   curl -I https://TU-DOMINIO.vercel.app/
   ```

   Deben aparecer `content-security-policy`, `strict-transport-security` y `x-content-type-options`.
4. **La API pública de Supabase debe estar cerrada.** Con la llave `anon` de tu proyecto (*Project Settings → API*):

   ```bash
   curl "https://TU-PROYECTO.supabase.co/rest/v1/usuarios?select=*" -H "apikey: TU_LLAVE_ANON"
   ```

   Debe responder un error de permisos, **nunca** filas de usuarios.
5. En el *Table Editor* de Supabase, las 7 tablas deben mostrar RLS activado.

## Desarrollo local

Con Docker (opcional): `docker compose up -d` levanta un Postgres local y en `.env` usas las variables del bloque "Docker" de `.env.example` (`DATABASE_SSL=false` y `MIGRAR_AL_ARRANCAR=true` para que aplique el esquema solo). O bien apunta `DATABASE_URL` a un proyecto de Supabase de pruebas. Después `npm run dev`.

Las pruebas (`npm test`) **no necesitan ninguna base de datos**: usan PGlite, PostgreSQL real compilado a WebAssembly y en memoria.

## Notas de seguridad

- Las variables (`SESSION_SECRET`, `DATABASE_URL`, `DATABASE_CA`) solo existen en Vercel. Si se cambia `SESSION_SECRET`, todas las sesiones abiertas se cierran (no se pierden datos).
- Las contraseñas se guardan únicamente como hash bcrypt; ni quien administra la base de datos puede leerlas.
- Todas las consultas van parametrizadas, y cada una filtra por el usuario de la sesión (un usuario no puede ver ni tocar datos ajenos).
- Los planes gratuitos de estas plataformas tienen límites (por ejemplo, Supabase puede pausar proyectos sin actividad y las funciones serverless tienen arranque en frío). Revisa las condiciones vigentes de cada una antes de la presentación.
