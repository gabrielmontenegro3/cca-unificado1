-- Marca o documento como disponível para o síndico ou para o morador.
-- Documentos antigos ficam sem público e continuam visíveis para os dois.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

ALTER TABLE public.documentos_empreendimento
  ADD COLUMN IF NOT EXISTS publico text;

ALTER TABLE public.documentos_empreendimento
  DROP CONSTRAINT IF EXISTS documentos_empreendimento_publico_check;

ALTER TABLE public.documentos_empreendimento
  ADD CONSTRAINT documentos_empreendimento_publico_check
  CHECK (publico IS NULL OR publico IN ('sindico', 'morador'));

DROP POLICY IF EXISTS docs_select ON public.documentos_empreendimento;
CREATE POLICY docs_select ON public.documentos_empreendimento
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao(condominio_id)
    OR public.user_cargo_tipo(condominio_id) = 'construtora'::public.tipo_cargo
    OR (
      public.user_cargo_tipo(condominio_id) = 'morador'::public.tipo_cargo
      AND (publico IS NULL OR publico = 'morador')
    )
    OR (
      public.user_cargo_tipo(condominio_id) = 'administracao'::public.tipo_cargo
      AND (publico IS NULL OR publico = 'sindico')
    )
  );
