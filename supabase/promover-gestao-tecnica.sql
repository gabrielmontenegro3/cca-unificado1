-- Marca o usuário como Gestão Técnica global (vê todos os condomínios).
-- 1) Troque o e-mail
-- 2) Rode o arquivo inteiro no SQL Editor (No limit)

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS gestao_tecnica BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.eh_gestao_tecnica(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT u.gestao_tecnica
      FROM public.usuarios u
      WHERE u.id = uid
        AND u.ativo IS TRUE
    ), FALSE)
    OR (
      uid = auth.uid()
      AND (
        COALESCE((auth.jwt() -> 'user_metadata' ->> 'gestao_tecnica')::boolean, FALSE)
        OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'gestao_tecnica')::boolean, FALSE)
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.usuario_condominio uc
      JOIN public.cargos c ON c.id = uc.cargo_id
      WHERE uc.usuario_id = uid
        AND uc.ativo IS TRUE
        AND c.tipo = 'gestao_tecnica'::public.tipo_cargo
    );
$$;

CREATE OR REPLACE FUNCTION public.user_is_gestao_tecnica()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.eh_gestao_tecnica(auth.uid());
$$;

-- TROQUE o e-mail abaixo pelo e-mail com o qual você entra no app.
INSERT INTO public.usuarios (id, nome, email, ativo, gestao_tecnica)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'nome', split_part(u.email, '@', 1)),
  u.email,
  TRUE,
  TRUE
FROM auth.users u
WHERE lower(u.email) = lower('cole-seu-email@dominio.com')
ON CONFLICT (id) DO UPDATE
  SET gestao_tecnica = TRUE,
      ativo = TRUE,
      email = EXCLUDED.email,
      updated_at = NOW();

SELECT id, email, gestao_tecnica, ativo
FROM public.usuarios
WHERE lower(email) = lower('cole-seu-email@dominio.com');
