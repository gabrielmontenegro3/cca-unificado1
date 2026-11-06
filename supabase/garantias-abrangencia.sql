-- Garantias divididas em dois tipos:
--   'usuario'       = garantia do usuário (unidade privativa)
--   'areas_comuns'  = garantia das áreas comuns (condomínio)
-- Garantias já cadastradas ficam sem tipo até alguém editar e escolher.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

ALTER TABLE public.garantias
  ADD COLUMN IF NOT EXISTS abrangencia text;

ALTER TABLE public.garantias
  DROP CONSTRAINT IF EXISTS garantias_abrangencia_check;
ALTER TABLE public.garantias
  ADD CONSTRAINT garantias_abrangencia_check
  CHECK (abrangencia IS NULL OR abrangencia IN ('usuario', 'areas_comuns'));

CREATE INDEX IF NOT EXISTS garantias_condo_abrangencia_idx
  ON public.garantias (condominio_id, abrangencia);

NOTIFY pgrst, 'reload schema';
