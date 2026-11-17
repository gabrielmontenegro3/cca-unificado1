-- Ordem das unidades na tela Recebimento (a Gestão Técnica arrasta para mudar).
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

ALTER TABLE public.unidades
  ADD COLUMN IF NOT EXISTS ordem integer;

-- Unidades que já existem ganham uma ordem inicial: bloco, depois o número (101, 102… 201).
WITH numeradas AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY condominio_id
      ORDER BY
        lower(COALESCE(bloco, '')),
        NULLIF(regexp_replace(COALESCE(identificacao, ''), '[^0-9]', '', 'g'), '')::bigint NULLS LAST,
        identificacao
    ) - 1 AS pos
  FROM public.unidades
  WHERE ordem IS NULL
)
UPDATE public.unidades u
SET ordem = n.pos
FROM numeradas n
WHERE n.id = u.id;

CREATE INDEX IF NOT EXISTS unidades_condo_ordem_idx
  ON public.unidades (condominio_id, ordem);

NOTIFY pgrst, 'reload schema';
