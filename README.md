# StudyFlow

Optimizador de horarios de estudio. Registras tus exámenes, evidencias y tareas con su fecha límite, capturas tu horario de clases, y StudyFlow genera automáticamente **cuándo estudiar cada cosa**, sin encimarse con tus clases y repartiendo la carga entre los días disponibles.

Proyecto individual de **Herramientas de Tecnologías de la Información** (Tecmilenio), con enfoque DevSecOps · Autor: Andre Hinojosa Guajardo · **En línea: <https://studyflow-seven-gules.vercel.app>**

> El algoritmo de priorización y agendado es desarrollo propio. La app **no consume ninguna API externa**.

## Qué incluye

- **Plan automático:** prioridad = urgencia × dificultad; respeta clases, límite diario, descansos y ventana horaria; avisa si algo no cabe antes de su fecha límite.
- **Entregables** (examen, evidencia, tarea) con nota opcional de qué estudiar, y **horarios fijos** que se pueden registrar en varios días de una vez.
- **Calendario** visual con un color por tipo (elegible por usuario), modo claro/oscuro y cuatro temas.
- **Cuentas:** registro e inicio de sesión, datos aislados por usuario, **perfil** con foto, cambio de usuario y contraseña, y eliminación de cuenta.

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Node.js 22 + Express |
| Base de datos | PostgreSQL (Supabase) |
| Frontend | HTML + Tailwind CSS + JavaScript vanilla |
| Despliegue | Vercel |
| Pruebas | Jest + Supertest (PGlite: PostgreSQL real en memoria) |
| Seguridad (DevSecOps) | ESLint + `eslint-plugin-security` (SAST), `npm audit` (SCA), Helmet, express-validator, GitHub Actions |

## Correrlo en local

Requisitos: Node.js 22+ y Docker (para un PostgreSQL local).

```bash
git clone https://github.com/Corklicense190/studyflow.git
cd studyflow
npm install
cp .env.example .env     # y activa el bloque "Docker" que trae el archivo
docker compose up -d
npm run dev
```

Abre <http://localhost:3000>. Para usar Supabase en lugar de Docker y para el despliegue en Vercel, ver [DESPLIEGUE.md](DESPLIEGUE.md).

| Comando | Qué hace |
|---|---|
| `npm run dev` | Compila el CSS y arranca el servidor con recarga |
| `npm test` | Pruebas de Jest (no necesitan base de datos) |
| `npm run lint` | Análisis estático de seguridad y estilo |
| `npm run build:css` | Compila Tailwind a `public/css/tailwind.css` |

## Seguridad

- Contraseñas con **bcrypt**; sesiones en el servidor, cookie `httpOnly` + `SameSite=Strict` (+ `Secure` en producción), que se cierra al recargar o cerrar la pestaña.
- Consultas SQL **siempre parametrizadas**; toda entrada se valida y se escapa; cada consulta filtra por el usuario de la sesión (sin acceso a datos ajenos).
- Protección contra fuerza bruta (límite de intentos), CSRF (`SameSite` + verificación de origen) y cabeceras HTTP con Helmet.
- Fotos de perfil: solo JPEG/PNG/WebP, con verificación del contenido real y tope de 300 KB.
- Secretos solo en variables de entorno (`.env` nunca se sube). Tablas de Supabase cerradas a su API pública.
- **CI** en cada Pull Request: ESLint, `npm audit` y Jest; la rama `main` está protegida.

## Estructura

```
algoritmo/    Lógica de priorización y agendado (módulo puro, probado con Jest)
routes/       API: auth, entregables, horarios, plan, configuracion, perfil
middleware/   Sesión, CSRF y reglas de cuenta
db/           Conexión a PostgreSQL, esquema SQL y almacenes de sesión y límites
public/       Frontend (index.html, js/, css/)
tests/        Pruebas de integración
```
