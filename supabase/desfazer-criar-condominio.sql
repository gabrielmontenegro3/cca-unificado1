-- Permite desfazer condomínio criado parcialmente (rollback na criação).
-- Rode no SQL Editor do Supabase.

CREATE OR REPLACE FUNCTION public.desfazer_criar_condominio(p_condominio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode desfazer a criação';
  END IF;
  IF p_condominio_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.condominios WHERE id = p_condominio_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.desfazer_criar_condominio(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
