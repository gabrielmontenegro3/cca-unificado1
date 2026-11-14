-- Locais: posição de cada local na lista (arrastar e soltar em "Editar tela").
-- Os locais que já existem ficam na ordem em que foram cadastrados.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

ALTER TABLE public.locais ADD COLUMN IF NOT EXISTS ordem integer;

UPDATE public.locais l
SET ordem = n.posicao
FROM (
  SELECT id, (row_number() OVER (PARTITION BY condominio_id ORDER BY created_at, nome) - 1)::int AS posicao
  FROM public.locais
) n
WHERE n.id = l.id
  AND l.ordem IS NULL;

CREATE INDEX IF NOT EXISTS locais_condo_ordem_idx ON public.locais (condominio_id, ordem);

NOTIFY pgrst, 'reload schema';
