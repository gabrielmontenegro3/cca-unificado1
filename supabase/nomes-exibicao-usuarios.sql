-- Nome de exibição para chat/chamados.
-- A leitura aninhada `usuarios(nome)` costuma voltar vazia para a Gestão Técnica
-- (RLS de public.usuarios exige vínculo no mesmo condomínio).
-- Rode no SQL Editor do Supabase (arquivo inteiro).

CREATE OR REPLACE FUNCTION public.nomes_exibicao_usuarios(p_ids uuid[])
RETURNS TABLE (usuario_id uuid, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    q.id AS usuario_id,
    COALESCE(
      CASE
        WHEN NULLIF(trim(u.nome), '') IS NOT NULL
         AND trim(u.nome) !~* '^(morador|equipe|usu[aá]rio)[[:space:]]*[0-9]*$'
         AND lower(trim(u.nome)) IS DISTINCT FROM lower(split_part(COALESCE(u.email, au.email, ''), '@', 1))
        THEN trim(u.nome)
        ELSE NULL
      END,
      NULLIF(trim(au.raw_user_meta_data->>'nome'), ''),
      NULLIF(trim(au.raw_user_meta_data->>'name'), ''),
      NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(trim(u.nome), ''),
      NULLIF(split_part(COALESCE(u.email, au.email, ''), '@', 1), ''),
      ''
    ) AS nome
  FROM unnest(COALESCE(p_ids, ARRAY[]::uuid[])) AS q(id)
  LEFT JOIN public.usuarios u ON u.id = q.id
  LEFT JOIN auth.users au ON au.id = q.id
  WHERE auth.uid() IS NOT NULL
    AND (
      q.id = auth.uid()
      OR public.user_is_gestao_tecnica()
      OR public.shares_condominio_with(q.id)
      OR EXISTS (
        SELECT 1
        FROM public.chamados c
        WHERE c.solicitante_id = q.id
          AND (
            c.solicitante_id = auth.uid()
            OR public.user_is_staff(c.condominio_id)
            OR public.user_is_gestao_tecnica()
          )
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.nomes_exibicao_usuarios(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
