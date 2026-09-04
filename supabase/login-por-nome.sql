-- Links de login com o nome do condomínio no lugar do UUID.
-- Rode o ARQUIVO INTEIRO no SQL Editor.
-- Se também for usar domínio personalizado, rode depois supabase/dominio-condominio.sql.

CREATE OR REPLACE FUNCTION public.slug_condominio(p_nome text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    trim(both '-' FROM regexp_replace(
      regexp_replace(
        lower(
          translate(
            trim(COALESCE(p_nome, '')),
            'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
            'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
          )
        ),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-{2,}', '-', 'g'
    )),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.resolver_login_condominio(p_ref text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  p_ref := trim(COALESCE(p_ref, ''));
  IF p_ref = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_id := p_ref::uuid;
    IF EXISTS (SELECT 1 FROM public.condominios WHERE id = v_id) THEN
      RETURN v_id;
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    v_id := NULL;
  END;

  v_slug := public.slug_condominio(p_ref);

  SELECT c.id
  INTO v_id
  FROM public.condominios c
  WHERE public.slug_condominio(c.nome) = v_slug
     OR lower(trim(c.nome)) = lower(p_ref)
  ORDER BY c.nome ASC, c.id ASC
  LIMIT 1;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.slug_condominio(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_login_condominio(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
