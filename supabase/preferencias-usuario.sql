-- Preferências de visualização por usuário
-- Rode no SQL Editor do Supabase.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS tema text,
  ADD COLUMN IF NOT EXISTS tamanho_fonte text,
  ADD COLUMN IF NOT EXISTS preferencias_ok boolean NOT NULL DEFAULT false;

ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_tema_check;
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_tema_check
  CHECK (tema IS NULL OR tema IN ('claro', 'escuro'));

ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_tamanho_fonte_check;
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_tamanho_fonte_check
  CHECK (tamanho_fonte IS NULL OR tamanho_fonte IN ('pequena', 'media', 'grande'));

-- Novos usuários (e quem ainda não configurou) veem a tela no primeiro acesso.
-- Opcional: isentar contas antigas de uma vez (descomente se precisar):
-- UPDATE public.usuarios
-- SET preferencias_ok = true,
--     tema = COALESCE(tema, 'claro'),
--     tamanho_fonte = COALESCE(tamanho_fonte, 'media')
-- WHERE preferencias_ok IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
