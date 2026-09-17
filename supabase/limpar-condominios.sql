-- CCA Unificado — apaga TODOS os condomínios e os dados ligados a eles
-- (chamados, laudos, unidades, arquivos no banco, vínculos, etc.).
-- Construtoras, usuários, cargos e logins (Auth) permanecem.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase. Irreversível.
--
-- Arquivos do bucket "condominios" NÃO entram neste SQL.
-- Depois, no Dashboard: Storage → condominios → Empty bucket.

SELECT COUNT(*) AS condominios_antes FROM public.condominios;

TRUNCATE TABLE public.condominios RESTART IDENTITY CASCADE;

SELECT COUNT(*) AS condominios_restantes FROM public.condominios;
