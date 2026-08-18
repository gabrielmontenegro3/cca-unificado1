-- Boletins: só administrador e Gestão Técnica criam.
-- Morador do condomínio só lê os publicados.
-- Manutenção: corrige o RLS que barrava o INSERT.
-- Rode o ARQUIVO INTEIRO.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.boletins_informativos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.boletim_arquivos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manutencoes_preventivas TO authenticated;
GRANT SELECT, INSERT ON TABLE public.manutencao_execucoes TO authenticated;

DROP POLICY IF EXISTS bol_select ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_write ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_insert ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_update ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_delete ON public.boletins_informativos;
DROP POLICY IF EXISTS ba_select ON public.boletim_arquivos;
DROP POLICY IF EXISTS ba_write ON public.boletim_arquivos;

CREATE POLICY bol_select ON public.boletins_informativos
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    AND (
      publicado IS TRUE
      OR public.user_is_gestao(condominio_id)
      OR public.user_is_gestao_tecnica()
    )
  );

CREATE POLICY bol_insert ON public.boletins_informativos
  FOR INSERT TO authenticated
  WITH CHECK (
    autor_id = auth.uid()
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_is_gestao(condominio_id)
    )
  );

CREATE POLICY bol_update ON public.boletins_informativos
  FOR UPDATE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  )
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );

CREATE POLICY bol_delete ON public.boletins_informativos
  FOR DELETE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );

CREATE POLICY ba_select ON public.boletim_arquivos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boletins_informativos b
      WHERE b.id = boletim_id
        AND public.user_belongs_to_condominio(b.condominio_id)
        AND (
          b.publicado IS TRUE
          OR public.user_is_gestao(b.condominio_id)
          OR public.user_is_gestao_tecnica()
        )
    )
  );
CREATE POLICY ba_write ON public.boletim_arquivos
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boletins_informativos b
      WHERE b.id = boletim_id
        AND (
          public.user_is_gestao_tecnica()
          OR public.user_is_gestao(b.condominio_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boletins_informativos b
      WHERE b.id = boletim_id
        AND (
          public.user_is_gestao_tecnica()
          OR public.user_is_gestao(b.condominio_id)
        )
    )
  );

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
  );

CREATE POLICY man_insert ON public.manutencoes_preventivas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );

CREATE POLICY man_update ON public.manutencoes_preventivas
  FOR UPDATE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  )
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );

CREATE POLICY man_delete ON public.manutencoes_preventivas
  FOR DELETE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );

DROP POLICY IF EXISTS mex_select ON public.manutencao_execucoes;
DROP POLICY IF EXISTS mex_write ON public.manutencao_execucoes;
CREATE POLICY mex_select ON public.manutencao_execucoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.manutencoes_preventivas m
      WHERE m.id = manutencao_id
        AND (
          public.user_belongs_to_condominio(m.condominio_id)
          OR public.user_is_gestao_tecnica()
        )
    )
  );
CREATE POLICY mex_write ON public.manutencao_execucoes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.manutencoes_preventivas m
      WHERE m.id = manutencao_id
        AND (
          public.user_is_gestao_tecnica()
          OR public.user_is_gestao(m.condominio_id)
        )
    )
  );

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
AS $$
DECLARE
  v_id uuid;
  v_periodo text;
  v_obs text;
  v_tipo text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_condominio_id IS NULL OR COALESCE(trim(p_sistema), '') = '' THEN
    RAISE EXCEPTION 'Informe o sistema da manutenção';
  END IF;
  IF NOT (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(p_condominio_id)
  ) THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica e o administrador cadastram manutenções';
  END IF;

  v_periodo := COALESCE(NULLIF(trim(p_periodicidade), ''), 'mensal');
  v_obs := NULLIF(trim(COALESCE(p_observacoes, '')), '');
  v_tipo := NULLIF(trim(COALESCE(p_tipo, '')), '');

  BEGIN
    INSERT INTO public.manutencoes_preventivas (
      condominio_id,
      sistema,
      tipo,
      periodicidade,
      observacoes,
      responsavel_id,
      proxima_execucao,
      ativo
    )
    VALUES (
      p_condominio_id,
      trim(p_sistema),
      v_tipo,
      v_periodo,
      v_obs,
      auth.uid(),
      COALESCE(p_proxima_execucao, CURRENT_DATE),
      TRUE
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN undefined_column THEN
      INSERT INTO public.manutencoes_preventivas (
        condominio_id,
        sistema,
        periodicidade,
        observacoes,
        responsavel_id,
        proxima_execucao,
        ativo
      )
      VALUES (
        p_condominio_id,
        trim(p_sistema),
        v_periodo,
        v_obs,
        auth.uid(),
        COALESCE(p_proxima_execucao, CURRENT_DATE),
        TRUE
      )
      RETURNING id INTO v_id;
  END;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_manutencao_preventiva(uuid, text, text, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_manutencao_preventiva(uuid, text, text, text, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
