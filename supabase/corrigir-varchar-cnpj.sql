-- Corrige erro: value too long for type character varying(18)
-- Costuma ser o CNPJ (formato 00.000.000/0000-00 = 18 chars).
-- Rode no SQL Editor do Supabase.

ALTER TABLE public.condominios
  ALTER COLUMN cnpj TYPE text
  USING cnpj::text;

ALTER TABLE public.fornecedores
  ALTER COLUMN cnpj TYPE text
  USING cnpj::text;

-- Campos curtos que também costumam estourar em cadastro livre
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'garantias' AND column_name = 'prazo_unidade'
  ) THEN
    ALTER TABLE public.garantias ALTER COLUMN prazo_unidade TYPE text USING prazo_unidade::text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fornecedores' AND column_name = 'telefone'
  ) THEN
    ALTER TABLE public.fornecedores ALTER COLUMN telefone TYPE text USING telefone::text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fornecedores' AND column_name = 'estado'
  ) THEN
    ALTER TABLE public.fornecedores ALTER COLUMN estado TYPE text USING estado::text;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
