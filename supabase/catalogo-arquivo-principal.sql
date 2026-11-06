-- Arquivo principal das telas Fornecedores, Materiais e Garantias.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.catalogo_arquivos_principais (
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  tela text NOT NULL CHECK (tela IN ('fornecedores', 'materiais', 'garantias')),
  arquivo_id uuid NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (condominio_id, tela)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.catalogo_arquivos_principais TO authenticated;

ALTER TABLE public.catalogo_arquivos_principais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cap_select ON public.catalogo_arquivos_principais;
DROP POLICY IF EXISTS cap_write ON public.catalogo_arquivos_principais;

CREATE POLICY cap_select ON public.catalogo_arquivos_principais
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );

CREATE POLICY cap_write ON public.catalogo_arquivos_principais
  FOR ALL TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  )
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );

NOTIFY pgrst, 'reload schema';
