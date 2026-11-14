-- Tela Recebimento: tópicos criados por condomínio (sem conteúdo pré-definido).
-- Cada tópico guarda seus blocos em ordem, em JSON:
--   { "tipo": "subtopico", "texto": "..." }
--   { "tipo": "texto",     "texto": "..." }
--   { "tipo": "destaque",  "texto": "...", "linkLabel": "...", "linkTo": "/visao-geral" }
-- Rode ESTE ARQUIVO INTEIRO no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.recebimento_secoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  blocos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocos) = 'array'),
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recebimento_secoes_condo_idx
  ON public.recebimento_secoes (condominio_id, ordem);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recebimento_secoes TO authenticated;

ALTER TABLE public.recebimento_secoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recebimento_select ON public.recebimento_secoes;
DROP POLICY IF EXISTS recebimento_write ON public.recebimento_secoes;
CREATE POLICY recebimento_select ON public.recebimento_secoes
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY recebimento_write ON public.recebimento_secoes
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id));

NOTIFY pgrst, 'reload schema';
