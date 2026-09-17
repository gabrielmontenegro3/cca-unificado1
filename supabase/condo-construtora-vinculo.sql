-- Vincula condomínio à construtora. Desfaz o wrapper quebrado.
-- Rode o ARQUIVO INTEIRO no SQL Editor (Run and enable RLS).

ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS construtora_id uuid REFERENCES public.construtoras(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS public.criar_condominio(text, text, text, text, text, text, text, text, text, text, jsonb, uuid);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'criar_condominio_base'
      AND pg_get_function_identity_arguments(p.oid) = 'text, text, text, text, text, text, text, text, text, text, jsonb'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'criar_condominio'
      AND pg_get_function_identity_arguments(p.oid) = 'text, text, text, text, text, text, text, text, text, text, jsonb'
  ) THEN
    ALTER FUNCTION public.criar_condominio_base(text, text, text, text, text, text, text, text, text, text, jsonb)
      RENAME TO criar_condominio;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.vincular_condominio_a_construtora(
  p_condominio_id uuid,
  p_construtora_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode vincular condomínio à construtora';
  END IF;
  IF p_condominio_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.condominios WHERE id = p_condominio_id) THEN
    RAISE EXCEPTION 'Condomínio não encontrado';
  END IF;
  IF p_construtora_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.construtoras WHERE id = p_construtora_id) THEN
    RAISE EXCEPTION 'Construtora não encontrada';
  END IF;

  UPDATE public.condominios
  SET construtora_id = p_construtora_id
  WHERE id = p_condominio_id;

  RETURN p_condominio_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vincular_condominio_a_construtora(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
