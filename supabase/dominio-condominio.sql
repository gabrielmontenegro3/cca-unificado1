-- Domínio personalizado por condomínio (para copiar o link de login).
-- Rode o ARQUIVO INTEIRO no SQL Editor.

ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS dominio text;

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

CREATE OR REPLACE FUNCTION public.normalizar_dominio(p_dominio text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    lower(regexp_replace(
      regexp_replace(
        regexp_replace(trim(COALESCE(p_dominio, '')), '^https?://', '', 'i'),
        '[/:].*$', ''
      ),
      '\.$', ''
    )),
    ''
  );
$$;

CREATE UNIQUE INDEX IF NOT EXISTS condominios_dominio_unique
  ON public.condominios (lower(dominio))
  WHERE dominio IS NOT NULL AND btrim(dominio) <> '';

CREATE OR REPLACE FUNCTION public.salvar_dominio_condominio(p_condominio_id uuid, p_dominio text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dom text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode salvar o domínio';
  END IF;
  IF p_condominio_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.condominios WHERE id = p_condominio_id) THEN
    RAISE EXCEPTION 'Condomínio não encontrado';
  END IF;

  v_dom := public.normalizar_dominio(p_dominio);

  IF v_dom IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.condominios c
    WHERE c.id <> p_condominio_id
      AND public.normalizar_dominio(c.dominio) = v_dom
  ) THEN
    RAISE EXCEPTION 'Este domínio já está em uso por outro condomínio';
  END IF;

  UPDATE public.condominios
  SET dominio = v_dom
  WHERE id = p_condominio_id;

  RETURN v_dom;
END;
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
  v_host text;
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

  v_host := public.normalizar_dominio(p_ref);
  IF v_host IS NOT NULL THEN
    SELECT c.id
    INTO v_id
    FROM public.condominios c
    WHERE public.normalizar_dominio(c.dominio) = v_host
    ORDER BY c.nome ASC, c.id ASC
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

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
GRANT EXECUTE ON FUNCTION public.normalizar_dominio(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_login_condominio(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_dominio_condominio(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
