-- Tipo de apartamento passa a pertencer à UNIDADE (e não mais ao morador).
--   * Regra por final: "final 01 e 06 = Tipo A" (para todos os blocos ou só um bloco).
--   * Exceção por unidade: a unidade pode ter um tipo próprio, que vence a regra.
--   * O morador herda o tipo da unidade a que está vinculado.
-- Pré-requisito: supabase/tipos-apartamento.sql e supabase/meu-imovel.sql já rodados.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

-- 1) Exceção por unidade.
ALTER TABLE public.unidades
  ADD COLUMN IF NOT EXISTS tipo_apartamento_id uuid REFERENCES public.tipos_apartamento(id) ON DELETE SET NULL;

-- 2) Regras por final ('' em bloco = vale para todos os blocos).
CREATE TABLE IF NOT EXISTS public.tipo_apartamento_finais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  bloco text NOT NULL DEFAULT '',
  final text NOT NULL,
  tipo_id uuid NOT NULL REFERENCES public.tipos_apartamento(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tipo_apartamento_finais_unico UNIQUE (condominio_id, bloco, final)
);

CREATE INDEX IF NOT EXISTS tipo_apartamento_finais_condo_idx
  ON public.tipo_apartamento_finais (condominio_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tipo_apartamento_finais TO authenticated;
ALTER TABLE public.tipo_apartamento_finais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS taf_select ON public.tipo_apartamento_finais;
DROP POLICY IF EXISTS taf_write ON public.tipo_apartamento_finais;
CREATE POLICY taf_select ON public.tipo_apartamento_finais
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY taf_write ON public.tipo_apartamento_finais
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id));

-- 3) Nada se perde: o tipo que já estava no morador vai para a unidade dele.
UPDATE public.unidades u
SET tipo_apartamento_id = uc.tipo_apartamento_id
FROM public.unidade_moradores um
JOIN public.usuario_condominio uc ON uc.usuario_id = um.usuario_id
WHERE um.unidade_id = u.id
  AND uc.condominio_id = u.condominio_id
  AND uc.tipo_apartamento_id IS NOT NULL
  AND u.tipo_apartamento_id IS NULL;

NOTIFY pgrst, 'reload schema';
