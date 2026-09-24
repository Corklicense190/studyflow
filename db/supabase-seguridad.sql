-- ============================================================
-- db/supabase-seguridad.sql
-- Solo para SUPABASE. Correr UNA vez en el SQL Editor, después de
-- db/esquema.sql.
--
-- Supabase publica automáticamente las tablas del esquema "public"
-- mediante una API REST. Esa API se autentica con la llave "anon",
-- que por diseño es pública. StudyFlow NO usa esa API (el servidor
-- se conecta directo a Postgres con su propio usuario), así que se
-- cierra por completo: sin RLS y sin permisos, cualquiera que
-- conociera la llave anon podría leer usuarios y hashes o modificar
-- datos saltándose toda la seguridad de la aplicación.
--
-- 1) Row Level Security activado y SIN políticas = las roles anon y
--    authenticated no pueden ver ni tocar nada.
-- 2) Además se les quitan los permisos sobre las tablas (defensa en
--    profundidad: si un día alguien desactiva RLS por error, sigue
--    sin haber acceso).
-- El servidor no se ve afectado: su rol (postgres) ignora RLS.
-- ============================================================

ALTER TABLE public.usuarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entregables       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horarios_fijos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bloques_estudio   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesiones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.limites_intentos  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.usuarios          FROM anon, authenticated;
REVOKE ALL ON public.entregables       FROM anon, authenticated;
REVOKE ALL ON public.horarios_fijos    FROM anon, authenticated;
REVOKE ALL ON public.bloques_estudio   FROM anon, authenticated;
REVOKE ALL ON public.configuracion     FROM anon, authenticated;
REVOKE ALL ON public.perfiles          FROM anon, authenticated;
REVOKE ALL ON public.sesiones          FROM anon, authenticated;
REVOKE ALL ON public.limites_intentos  FROM anon, authenticated;
