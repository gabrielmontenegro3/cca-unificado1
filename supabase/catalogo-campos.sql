-- Campos extras do catálogo (fornecedores / garantias).
-- Rode no SQL Editor do Supabase.

ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS telefone1 text,
  ADD COLUMN IF NOT EXISTS telefone2 text,
  ADD COLUMN IF NOT EXISTS localizacao text;

ALTER TABLE public.garantias
  ADD COLUMN IF NOT EXISTS telefone text;

-- Garante que telefone/cnpj aceitem texto livre
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fornecedores' AND column_name = 'telefone'
  ) THEN
    ALTER TABLE public.fornecedores ALTER COLUMN telefone TYPE text USING telefone::text;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
