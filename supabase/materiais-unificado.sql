-- Materiais, Fornecedores e Garantias viram uma tela só (Materiais).
-- Cada produto tem: nome, um ou mais fornecedores, especificações e a garantia (texto livre).
-- Os dados que já existem são aproveitados:
--   * fornecedor ligado ao material  -> primeiro nome da lista de fornecedores
--   * tempo/descrição/perda da garantia -> texto da garantia
-- Nada é apagado: as tabelas antigas continuam no banco.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

ALTER TABLE public.materiais ADD COLUMN IF NOT EXISTS especificacoes text;
ALTER TABLE public.materiais ADD COLUMN IF NOT EXISTS garantia text;
ALTER TABLE public.materiais ADD COLUMN IF NOT EXISTS fornecedores_nomes text[] NOT NULL DEFAULT '{}';

-- Fornecedor que já estava ligado ao material.
UPDATE public.materiais m
SET fornecedores_nomes = ARRAY[COALESCE(NULLIF(trim(f.nome_fantasia), ''), NULLIF(trim(f.nome), ''), NULLIF(trim(f.razao_social), ''))]
FROM public.fornecedores f
WHERE f.id = m.fornecedor_id
  AND COALESCE(array_length(m.fornecedores_nomes, 1), 0) = 0
  AND COALESCE(NULLIF(trim(f.nome_fantasia), ''), NULLIF(trim(f.nome), ''), NULLIF(trim(f.razao_social), '')) IS NOT NULL;

-- Garantia escrita a partir dos campos antigos do material.
UPDATE public.materiais m
SET garantia = NULLIF(trim(concat_ws(E'\n',
  CASE WHEN m.prazo_valor IS NOT NULL
    THEN m.prazo_valor::text || ' ' || COALESCE(NULLIF(trim(m.prazo_unidade::text), ''), 'anos')
  END,
  NULLIF(trim(m.descricao), ''),
  CASE WHEN NULLIF(trim(m.motivos_perda_garantia), '') IS NOT NULL
    THEN 'Perda da garantia: ' || trim(m.motivos_perda_garantia)
  END
)), '')
WHERE m.garantia IS NULL;

NOTIFY pgrst, 'reload schema';
