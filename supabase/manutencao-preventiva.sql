-- CCA Unificado — cadastro de manutenção preventiva
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manutencoes_preventivas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manutencao_execucoes TO authenticated;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS gestao_tecnica BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS admin_sistema BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  ALTER TABLE public.manutencoes_preventivas ALTER COLUMN tipo DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.pode_cadastrar_manutencao(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(cid)
    OR public.user_cargo_tipo(cid) IN (
      'administrador'::public.tipo_cargo,
      'administracao'::public.tipo_cargo,
      'gestao_tecnica'::public.tipo_cargo
    )
    OR COALESCE((
      SELECT u.gestao_tecnica OR u.admin_sistema
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.ativo IS TRUE
    ), FALSE);
$$;

DROP POLICY IF EXISTS man_select ON public.manutencoes_preventivas;
DROP POLICY IF EXISTS man_write ON public.manutencoes_preventivas;
DROP POLICY IF EXISTS man_insert ON public.manutencoes_preventivas;
DROP POLICY IF EXISTS man_update ON public.manutencoes_preventivas;
DROP POLICY IF EXISTS man_delete ON public.manutencoes_preventivas;

CREATE POLICY man_select ON public.manutencoes_preventivas
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
    OR public.pode_cadastrar_manutencao(condominio_id)
  );

CREATE POLICY man_insert ON public.manutencoes_preventivas
  FOR INSERT TO authenticated
  WITH CHECK (public.pode_cadastrar_manutencao(condominio_id));

CREATE POLICY man_update ON public.manutencoes_preventivas
  FOR UPDATE TO authenticated
  USING (public.pode_cadastrar_manutencao(condominio_id))
  WITH CHECK (public.pode_cadastrar_manutencao(condominio_id));

CREATE POLICY man_delete ON public.manutencoes_preventivas
  FOR DELETE TO authenticated
  USING (public.pode_cadastrar_manutencao(condominio_id));

CREATE OR REPLACE FUNCTION public.criar_manutencao_preventiva(
  p_condominio_id uuid,
  p_sistema text,
  p_tipo text,
  p_periodicidade text,
  p_observacoes text,
  p_proxima_execucao date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_condominio_id IS NULL OR COALESCE(trim(p_sistema), '') = '' THEN
    RAISE EXCEPTION 'Informe o sistema da manutenção';
  END IF;
  IF NOT public.pode_cadastrar_manutencao(p_condominio_id) THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica e o administrador cadastram manutenções';
  END IF;

  INSERT INTO public.manutencoes_preventivas (
    condominio_id,
    sistema,
    periodicidade,
    responsavel_id,
    proxima_execucao,
    ativo
  )
  VALUES (
    p_condominio_id,
    trim(p_sistema),
    COALESCE(NULLIF(trim(p_periodicidade), ''), 'mensal')::public.tipo_periodicidade,
    auth.uid(),
    COALESCE(p_proxima_execucao, CURRENT_DATE),
    TRUE
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pode_cadastrar_manutencao(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_cadastrar_manutencao(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.criar_manutencao_preventiva(uuid, text, text, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_manutencao_preventiva(uuid, text, text, text, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
