-- Leitura para morador, construtora e administração.
-- Só Gestão Técnica e administrador gravam nestas tabelas.
-- Rode o ARQUIVO INTEIRO no SQL Editor.

DROP POLICY IF EXISTS forn_select ON public.fornecedores;
DROP POLICY IF EXISTS forn_write ON public.fornecedores;
CREATE POLICY forn_select ON public.fornecedores
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY forn_write ON public.fornecedores
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS mat_select ON public.materiais;
DROP POLICY IF EXISTS mat_write ON public.materiais;
CREATE POLICY mat_select ON public.materiais
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY mat_write ON public.materiais
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS loc_select ON public.locais;
DROP POLICY IF EXISTS loc_write ON public.locais;
CREATE POLICY loc_select ON public.locais
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY loc_write ON public.locais
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS gar_select ON public.garantias;
DROP POLICY IF EXISTS gar_write ON public.garantias;
CREATE POLICY gar_select ON public.garantias
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY gar_write ON public.garantias
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS ct_select ON public.contatos;
DROP POLICY IF EXISTS ct_write ON public.contatos;
CREATE POLICY ct_select ON public.contatos
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    AND (ativo IS TRUE OR public.user_is_gestao(condominio_id))
  );
CREATE POLICY ct_write ON public.contatos
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS sn_select ON public.sobre_nos;
DROP POLICY IF EXISTS sn_write ON public.sobre_nos;
CREATE POLICY sn_select ON public.sobre_nos
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY sn_write ON public.sobre_nos
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

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

DROP POLICY IF EXISTS ml_all ON public.material_locais;
DROP POLICY IF EXISTS ml_select ON public.material_locais;
DROP POLICY IF EXISTS ml_write ON public.material_locais;
CREATE POLICY ml_select ON public.material_locais
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id
        AND public.user_belongs_to_condominio(m.condominio_id)
    )
  );
CREATE POLICY ml_write ON public.material_locais
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id AND public.user_is_gestao(m.condominio_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id AND public.user_is_gestao(m.condominio_id)
    )
  );

DROP POLICY IF EXISTS mg_all ON public.material_garantias;
DROP POLICY IF EXISTS mg_select ON public.material_garantias;
DROP POLICY IF EXISTS mg_write ON public.material_garantias;
CREATE POLICY mg_select ON public.material_garantias
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id
        AND public.user_belongs_to_condominio(m.condominio_id)
    )
  );
CREATE POLICY mg_write ON public.material_garantias
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id AND public.user_is_gestao(m.condominio_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id AND public.user_is_gestao(m.condominio_id)
    )
  );

NOTIFY pgrst, 'reload schema';
