-- Acesso ao portal da construtora para quem pertence a ela.
-- Rode o ARQUIVO INTEIRO no SQL Editor.

ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS construtora_id uuid REFERENCES public.construtoras(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dominio text;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS construtora_id uuid REFERENCES public.construtoras(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.usuario_construtora_escopo (
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, condominio_id)
);

CREATE OR REPLACE FUNCTION public.usuario_construtora_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.construtora_id
  FROM public.usuarios u
  WHERE u.id = auth.uid()
    AND COALESCE(u.ativo, TRUE) IS TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_is_construtora_org()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.usuario_construtora_id() IS NOT NULL
    AND COALESCE((SELECT u.gestao_tecnica FROM public.usuarios u WHERE u.id = auth.uid()), FALSE) IS FALSE
    AND COALESCE((SELECT u.admin_sistema FROM public.usuarios u WHERE u.id = auth.uid()), FALSE) IS FALSE;
$$;

CREATE OR REPLACE FUNCTION public.tem_acesso_construtora(p_construtora_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_construtora_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      public.user_is_gestao_tecnica()
      OR public.usuario_construtora_id() = p_construtora_id
      OR EXISTS (
        SELECT 1
        FROM public.usuario_condominio uc
        JOIN public.condominios d ON d.id = uc.condominio_id
        LEFT JOIN public.cargos cg ON cg.id = uc.cargo_id
        WHERE uc.usuario_id = auth.uid()
          AND COALESCE(uc.ativo, TRUE) IS TRUE
          AND d.construtora_id = p_construtora_id
          AND cg.tipo = 'construtora'::public.tipo_cargo
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.user_is_construtora_org_do_condominio(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    JOIN public.condominios d ON d.construtora_id = u.construtora_id
    WHERE u.id = auth.uid()
      AND COALESCE(u.ativo, TRUE) IS TRUE
      AND u.construtora_id IS NOT NULL
      AND d.id = cid
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.usuario_construtora_escopo e
          WHERE e.usuario_id = u.id
        )
        OR EXISTS (
          SELECT 1 FROM public.usuario_construtora_escopo e
          WHERE e.usuario_id = u.id
            AND e.condominio_id = cid
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_belongs_to_condominio(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
  OR EXISTS (
    SELECT 1
    FROM public.usuario_condominio uc
    WHERE uc.usuario_id = auth.uid()
      AND uc.condominio_id = cid
      AND COALESCE(uc.ativo, TRUE) IS TRUE
  )
  OR public.user_is_construtora_org_do_condominio(cid);
$$;

CREATE OR REPLACE FUNCTION public.vincular_condominio_a_construtora(
  p_condominio_id uuid,
  p_construtora_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode vincular condomínio à construtora';
  END IF;
  IF p_condominio_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.condominios WHERE id = p_condominio_id) THEN
    RAISE EXCEPTION 'Condomínio não encontrado';
  END IF;
  IF p_construtora_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.construtoras WHERE id = p_construtora_id) THEN
    RAISE EXCEPTION 'Construtora não encontrada';
  END IF;

  UPDATE public.condominios
  SET construtora_id = p_construtora_id
  WHERE id = p_condominio_id;

  RETURN p_condominio_id;
END;
$$;

DROP FUNCTION IF EXISTS public.listar_condominios_da_minha_construtora();
DROP FUNCTION IF EXISTS public.listar_condominios_da_minha_construtora(uuid);

CREATE FUNCTION public.listar_condominios_da_minha_construtora(p_construtora_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  nome text,
  logo_path text,
  ativo boolean,
  construtora_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF public.user_is_gestao_tecnica() THEN
    v_id := p_construtora_id;
  ELSE
    v_id := public.usuario_construtora_id();
    IF v_id IS NULL THEN
      v_id := p_construtora_id;
    END IF;
    IF p_construtora_id IS NOT NULL AND v_id IS DISTINCT FROM p_construtora_id THEN
      RETURN;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    q.cid,
    q.nome_out,
    q.logo_out,
    q.ativo_out,
    q.construtora_out
  FROM (
    SELECT
      d.id AS cid,
      d.nome::text AS nome_out,
      d.logo_path::text AS logo_out,
      COALESCE(d.ativo, TRUE)::boolean AS ativo_out,
      d.construtora_id AS construtora_out
    FROM public.condominios d
    WHERE d.construtora_id = v_id
      AND (
        public.user_is_gestao_tecnica()
        OR NOT EXISTS (
          SELECT 1 FROM public.usuario_construtora_escopo e
          WHERE e.usuario_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.usuario_construtora_escopo e
          WHERE e.usuario_id = auth.uid()
            AND e.condominio_id = d.id
        )
      )
  ) q
  ORDER BY q.nome_out;
END;
$$;

DROP POLICY IF EXISTS construtoras_select ON public.construtoras;
CREATE POLICY construtoras_select ON public.construtoras
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR id = public.usuario_construtora_id()
  );

DROP POLICY IF EXISTS condominios_select ON public.condominios;
CREATE POLICY condominios_select ON public.condominios
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(id)
  );

GRANT EXECUTE ON FUNCTION public.usuario_construtora_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_construtora_org() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tem_acesso_construtora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_construtora_org_do_condominio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_belongs_to_condominio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_condominio_a_construtora(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_condominios_da_minha_construtora(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
