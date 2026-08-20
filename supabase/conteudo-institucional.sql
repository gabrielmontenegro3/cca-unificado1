-- Corrige o RLS de visao_geral_secoes, material_locais e do restante
-- do conteúdo gravado na criação do condomínio.
-- A Gestão Técnica global passa a poder inserir mesmo sem vínculo
-- ainda criado em usuario_condominio.
-- Rode o ARQUIVO INTEIRO.

CREATE OR REPLACE FUNCTION public.user_is_staff(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
  OR public.user_cargo_tipo(cid) IN (
    'administrador'::public.tipo_cargo,
    'gestao_tecnica'::public.tipo_cargo,
    'administracao'::public.tipo_cargo
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_gestao(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
  OR public.user_cargo_tipo(cid) IN (
    'administrador'::public.tipo_cargo,
    'gestao_tecnica'::public.tipo_cargo
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_gestao(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.after_condominio_insert_gestao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.vincular_todas_gestoes_ao_condominio(NEW.id);
  IF public.user_is_gestao_tecnica() AND auth.uid() IS NOT NULL THEN
    PERFORM public.vincular_gestao_a_todos_condominios(auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.visao_geral_secoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.empreendimento_secoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documentos_empreendimento TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imagens_condominio TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sobre_nos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contatos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.unidades TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fornecedores TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.materiais TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.locais TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.garantias TO authenticated;

DROP POLICY IF EXISTS vg_select ON public.visao_geral_secoes;
DROP POLICY IF EXISTS vg_write ON public.visao_geral_secoes;
DROP POLICY IF EXISTS vg_insert ON public.visao_geral_secoes;
DROP POLICY IF EXISTS vg_update ON public.visao_geral_secoes;
DROP POLICY IF EXISTS vg_delete ON public.visao_geral_secoes;
CREATE POLICY vg_select ON public.visao_geral_secoes
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY vg_insert ON public.visao_geral_secoes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR public.user_is_staff(condominio_id)
  );
CREATE POLICY vg_update ON public.visao_geral_secoes
  FOR UPDATE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_staff(condominio_id)
  )
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR public.user_is_staff(condominio_id)
  );
CREATE POLICY vg_delete ON public.visao_geral_secoes
  FOR DELETE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_staff(condominio_id)
  );

DROP POLICY IF EXISTS emp_select ON public.empreendimento_secoes;
DROP POLICY IF EXISTS emp_write ON public.empreendimento_secoes;
CREATE POLICY emp_select ON public.empreendimento_secoes
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY emp_write ON public.empreendimento_secoes
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS docs_select ON public.documentos_empreendimento;
DROP POLICY IF EXISTS docs_write ON public.documentos_empreendimento;
CREATE POLICY docs_select ON public.documentos_empreendimento
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY docs_write ON public.documentos_empreendimento
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS img_select ON public.imagens_condominio;
DROP POLICY IF EXISTS img_write ON public.imagens_condominio;
CREATE POLICY img_select ON public.imagens_condominio
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY img_write ON public.imagens_condominio
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS sn_select ON public.sobre_nos;
DROP POLICY IF EXISTS sn_write ON public.sobre_nos;
CREATE POLICY sn_select ON public.sobre_nos
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY sn_write ON public.sobre_nos
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS ct_select ON public.contatos;
DROP POLICY IF EXISTS ct_write ON public.contatos;
CREATE POLICY ct_select ON public.contatos
  FOR SELECT TO authenticated
  USING (
    (public.user_belongs_to_condominio(condominio_id) OR public.user_is_gestao_tecnica())
    AND (ativo IS TRUE OR public.user_is_gestao(condominio_id) OR public.user_is_gestao_tecnica())
  );
CREATE POLICY ct_write ON public.contatos
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS unidades_select ON public.unidades;
DROP POLICY IF EXISTS unidades_write ON public.unidades;
CREATE POLICY unidades_select ON public.unidades
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY unidades_write ON public.unidades
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS forn_select ON public.fornecedores;
DROP POLICY IF EXISTS forn_write ON public.fornecedores;
CREATE POLICY forn_select ON public.fornecedores
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY forn_write ON public.fornecedores
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS mat_select ON public.materiais;
DROP POLICY IF EXISTS mat_write ON public.materiais;
CREATE POLICY mat_select ON public.materiais
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY mat_write ON public.materiais
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS loc_select ON public.locais;
DROP POLICY IF EXISTS loc_write ON public.locais;
CREATE POLICY loc_select ON public.locais
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY loc_write ON public.locais
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS gar_select ON public.garantias;
DROP POLICY IF EXISTS gar_write ON public.garantias;
CREATE POLICY gar_select ON public.garantias
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY gar_write ON public.garantias
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_gestao(condominio_id));

CREATE OR REPLACE FUNCTION public.pode_gerir_material(p_material_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.materiais m
    WHERE m.id = p_material_id
      AND (public.user_is_gestao_tecnica() OR public.user_is_gestao(m.condominio_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.pode_gerir_garantia(p_garantia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.garantias g
    WHERE g.id = p_garantia_id
      AND (public.user_is_gestao_tecnica() OR public.user_is_gestao(g.condominio_id))
  );
$$;

GRANT EXECUTE ON FUNCTION public.pode_gerir_material(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_gerir_garantia(uuid) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.material_locais TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.material_garantias TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fornecedor_garantias TO authenticated;

DROP POLICY IF EXISTS ml_all ON public.material_locais;
DROP POLICY IF EXISTS ml_select ON public.material_locais;
DROP POLICY IF EXISTS ml_write ON public.material_locais;
CREATE POLICY ml_select ON public.material_locais
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id
        AND (
          public.user_belongs_to_condominio(m.condominio_id)
          OR public.user_is_gestao_tecnica()
        )
    )
  );
CREATE POLICY ml_write ON public.material_locais
  FOR ALL TO authenticated
  USING (public.pode_gerir_material(material_id))
  WITH CHECK (public.pode_gerir_material(material_id));

DROP POLICY IF EXISTS mg_all ON public.material_garantias;
DROP POLICY IF EXISTS mg_select ON public.material_garantias;
DROP POLICY IF EXISTS mg_write ON public.material_garantias;
CREATE POLICY mg_select ON public.material_garantias
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id
        AND (
          public.user_belongs_to_condominio(m.condominio_id)
          OR public.user_is_gestao_tecnica()
        )
    )
  );
CREATE POLICY mg_write ON public.material_garantias
  FOR ALL TO authenticated
  USING (public.pode_gerir_material(material_id))
  WITH CHECK (public.pode_gerir_material(material_id));

DROP POLICY IF EXISTS fg_all ON public.fornecedor_garantias;
DROP POLICY IF EXISTS fg_select ON public.fornecedor_garantias;
DROP POLICY IF EXISTS fg_write ON public.fornecedor_garantias;
CREATE POLICY fg_select ON public.fornecedor_garantias
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.garantias g
      WHERE g.id = garantia_id
        AND (
          public.user_belongs_to_condominio(g.condominio_id)
          OR public.user_is_gestao_tecnica()
        )
    )
  );
CREATE POLICY fg_write ON public.fornecedor_garantias
  FOR ALL TO authenticated
  USING (public.pode_gerir_garantia(garantia_id))
  WITH CHECK (public.pode_gerir_garantia(garantia_id));

NOTIFY pgrst, 'reload schema';
