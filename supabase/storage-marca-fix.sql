-- Restaura logo, capa, login e visão geral do condomínio no Storage.
-- Rode o ARQUIVO INTEIRO no SQL Editor.

CREATE OR REPLACE FUNCTION public.storage_path_uuid(p_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_part text := split_part(COALESCE(p_name, ''), '/', 1);
BEGIN
  IF v_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_part::uuid;
  END IF;
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

DROP POLICY IF EXISTS storage_condo_select ON storage.objects;
DROP POLICY IF EXISTS storage_marca_anon ON storage.objects;

CREATE POLICY storage_marca_anon ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'condominios'
    AND split_part(name, '/', 2) = 'marca'
  );

CREATE POLICY storage_condo_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'condominios'
    AND (
      split_part(name, '/', 2) = 'marca'
      OR public.user_is_gestao_tecnica()
      OR split_part(name, '/', 2) = 'perfil'
      OR (
        public.storage_path_uuid(name) IS NOT NULL
        AND public.user_belongs_to_condominio(public.storage_path_uuid(name))
      )
      OR (
        public.user_is_construtora_org()
        AND EXISTS (
          SELECT 1
          FROM public.construtoras x
          JOIN public.usuarios u ON u.construtora_id = x.id
          WHERE u.id = auth.uid()
            AND x.id::text = split_part(name, '/', 1)
        )
      )
    )
  );

GRANT EXECUTE ON FUNCTION public.storage_path_uuid(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
