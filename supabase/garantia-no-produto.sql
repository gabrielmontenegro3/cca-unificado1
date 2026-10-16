-- CCA Unificado — Garantia atrelada ao produto (materiais)
-- Rode o ARQUIVO INTEIRO no SQL Editor.

ALTER TABLE public.materiais
  ADD COLUMN IF NOT EXISTS prazo_valor numeric,
  ADD COLUMN IF NOT EXISTS prazo_unidade text,
  ADD COLUMN IF NOT EXISTS data_fim date,
  ADD COLUMN IF NOT EXISTS motivos_perda_garantia text,
  ADD COLUMN IF NOT EXISTS descricao text,
  ADD COLUMN IF NOT EXISTS telefone text;

-- Copia a primeira garantia vinculada para o produto (dados legados).
UPDATE public.materiais m
SET
  prazo_valor = COALESCE(m.prazo_valor, g.prazo_valor),
  prazo_unidade = COALESCE(NULLIF(trim(m.prazo_unidade), ''), g.prazo_unidade),
  data_fim = COALESCE(m.data_fim, g.data_fim),
  motivos_perda_garantia = COALESCE(NULLIF(trim(m.motivos_perda_garantia), ''), g.motivos_perda_garantia),
  descricao = COALESCE(NULLIF(trim(m.descricao), ''), g.descricao),
  telefone = COALESCE(NULLIF(trim(m.telefone), ''), g.telefone)
FROM (
  SELECT DISTINCT ON (mg.material_id)
    mg.material_id,
    g.prazo_valor,
    g.prazo_unidade,
    g.data_fim,
    g.motivos_perda_garantia,
    g.descricao,
    g.telefone
  FROM public.material_garantias mg
  JOIN public.garantias g ON g.id = mg.garantia_id
  ORDER BY mg.material_id, mg.garantia_id
) g
WHERE m.id = g.material_id
  AND m.prazo_valor IS NULL
  AND m.data_fim IS NULL
  AND COALESCE(NULLIF(trim(m.motivos_perda_garantia), ''), '') = ''
  AND COALESCE(NULLIF(trim(m.descricao), ''), '') = ''
  AND COALESCE(NULLIF(trim(m.telefone), ''), '') = '';

NOTIFY pgrst, 'reload schema';
