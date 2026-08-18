-- Cria o bucket e libera RLS de arquivos para a Gestão Técnica.
-- Rode o ARQUIVO INTEIRO no SQL Editor.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('condominios', 'condominios', false, 52428800, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_condo_select ON storage.objects;
DROP POLICY IF EXISTS storage_condo_insert ON storage.objects;
DROP POLICY IF EXISTS storage_condo_update ON storage.objects;
DROP POLICY IF EXISTS storage_condo_delete ON storage.objects;

CREATE POLICY storage_condo_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'condominios'
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
    )
  );

CREATE POLICY storage_condo_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'condominios'
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
    )
  );

CREATE POLICY storage_condo_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'condominios'
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
    )
  );

CREATE POLICY storage_condo_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'condominios'
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
      OR owner = auth.uid()
    )
  );

-- Metadados do arquivo (é esta tabela que está bloqueando agora)
DROP POLICY IF EXISTS arq_select ON public.arquivos;
DROP POLICY IF EXISTS arq_insert ON public.arquivos;
DROP POLICY IF EXISTS arq_delete ON public.arquivos;
DROP POLICY IF EXISTS arq_update ON public.arquivos;

CREATE POLICY arq_select ON public.arquivos
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(condominio_id)
  );

CREATE POLICY arq_insert ON public.arquivos
  FOR INSERT TO authenticated
  WITH CHECK (
    enviado_por = auth.uid()
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_belongs_to_condominio(condominio_id)
    )
  );

CREATE POLICY arq_delete ON public.arquivos
  FOR DELETE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR enviado_por = auth.uid()
    OR public.user_belongs_to_condominio(condominio_id)
  );

DROP POLICY IF EXISTS img_select ON public.imagens_condominio;
DROP POLICY IF EXISTS img_write ON public.imagens_condominio;
CREATE POLICY img_select ON public.imagens_condominio
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(condominio_id)
  );
CREATE POLICY img_write ON public.imagens_condominio
  FOR ALL TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(condominio_id)
  )
  WITH CHECK (public.user_is_gestao_tecnica());

DROP POLICY IF EXISTS docs_select ON public.documentos_empreendimento;
DROP POLICY IF EXISTS docs_write ON public.documentos_empreendimento;
CREATE POLICY docs_select ON public.documentos_empreendimento
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(condominio_id)
  );
CREATE POLICY docs_write ON public.documentos_empreendimento
  FOR ALL TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(condominio_id)
  )
  WITH CHECK (public.user_is_gestao_tecnica());
