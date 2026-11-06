-- Manual de uso do condomínio: um PDF por empreendimento.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.manuais_uso (
  condominio_id uuid PRIMARY KEY REFERENCES public.condominios(id) ON DELETE CASCADE,
  arquivo_id uuid NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manuais_uso TO authenticated;

ALTER TABLE public.manuais_uso ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manual_select ON public.manuais_uso;
DROP POLICY IF EXISTS manual_write ON public.manuais_uso;

CREATE POLICY manual_select ON public.manuais_uso
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );

CREATE POLICY manual_write ON public.manuais_uso
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica())
  WITH CHECK (public.user_is_gestao_tecnica());

NOTIFY pgrst, 'reload schema';
