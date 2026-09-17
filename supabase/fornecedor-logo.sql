-- Logo e identificação dos fornecedores.
-- Rode no SQL Editor do Supabase.

ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS logo_path text,
  ADD COLUMN IF NOT EXISTS razao_social text,
  ADD COLUMN IF NOT EXISTS nome_fantasia text;

NOTIFY pgrst, 'reload schema';
