-- Marca visual do condomínio (logo, capa, login, visão geral).
-- Rode o ARQUIVO INTEIRO no SQL Editor.
-- Precisa disso para a tela de login pública mostrar nome e logo.

ALTER TABLE public.condominios ADD COLUMN IF NOT EXISTS logo_path text;
ALTER TABLE public.imagens_condominio ADD COLUMN IF NOT EXISTS tipo text;

UPDATE public.imagens_condominio
SET tipo = CASE
  WHEN lower(titulo) IN ('logo') THEN 'logo'
  WHEN lower(titulo) IN ('imagem visão geral', 'imagem visao geral', 'visão geral', 'visao geral') THEN 'visao_geral'
  WHEN lower(titulo) IN ('imagem capa', 'capa') THEN 'capa'
  WHEN lower(titulo) IN ('imagem login', 'login') THEN 'login'
  ELSE tipo
END
WHERE tipo IS NULL;

CREATE OR REPLACE FUNCTION public.marca_condominio(p_condominio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_nome text;
  v_logo text;
  v_capa text;
  v_visao text;
  v_login text;
BEGIN
  SELECT c.nome, NULLIF(c.logo_path, '')
  INTO v_nome, v_logo
  FROM public.condominios c
  WHERE c.id = p_condominio_id;

  v_logo := COALESCE(
    (
      SELECT a.storage_path
      FROM public.imagens_condominio i
      JOIN public.arquivos a ON a.id = i.arquivo_id
      WHERE i.condominio_id = p_condominio_id
        AND (i.tipo = 'logo' OR lower(i.titulo) = 'logo')
      ORDER BY i.id DESC
      LIMIT 1
    ),
    v_logo,
    (
      SELECT o.name
      FROM storage.objects o
      WHERE o.bucket_id = 'condominios'
        AND (
          o.name LIKE p_condominio_id::text || '/marca/logo.%'
          OR o.name ILIKE p_condominio_id::text || '/marca/%logo%'
        )
      ORDER BY o.created_at DESC
      LIMIT 1
    )
  );

  v_capa := COALESCE(
    (
      SELECT a.storage_path
      FROM public.imagens_condominio i
      JOIN public.arquivos a ON a.id = i.arquivo_id
      WHERE i.condominio_id = p_condominio_id
        AND (i.tipo = 'capa' OR lower(i.titulo) IN ('imagem capa', 'capa'))
      ORDER BY i.id DESC
      LIMIT 1
    ),
    (
      SELECT o.name
      FROM storage.objects o
      WHERE o.bucket_id = 'condominios'
        AND o.name LIKE p_condominio_id::text || '/marca/capa.%'
      ORDER BY o.created_at DESC
      LIMIT 1
    )
  );

  v_visao := COALESCE(
    (
      SELECT a.storage_path
      FROM public.imagens_condominio i
      JOIN public.arquivos a ON a.id = i.arquivo_id
      WHERE i.condominio_id = p_condominio_id
        AND (i.tipo = 'visao_geral' OR lower(i.titulo) IN ('imagem visão geral', 'imagem visao geral'))
      ORDER BY i.id DESC
      LIMIT 1
    ),
    (
      SELECT o.name
      FROM storage.objects o
      WHERE o.bucket_id = 'condominios'
        AND o.name LIKE p_condominio_id::text || '/marca/visao_geral.%'
      ORDER BY o.created_at DESC
      LIMIT 1
    )
  );

  v_login := COALESCE(
    (
      SELECT a.storage_path
      FROM public.imagens_condominio i
      JOIN public.arquivos a ON a.id = i.arquivo_id
      WHERE i.condominio_id = p_condominio_id
        AND (i.tipo = 'login' OR lower(i.titulo) IN ('imagem login', 'login'))
      ORDER BY i.id DESC
      LIMIT 1
    ),
    (
      SELECT o.name
      FROM storage.objects o
      WHERE o.bucket_id = 'condominios'
        AND o.name LIKE p_condominio_id::text || '/marca/login.%'
      ORDER BY o.created_at DESC
      LIMIT 1
    )
  );

  RETURN jsonb_build_object(
    'nome', v_nome,
    'logo', v_logo,
    'capa', v_capa,
    'visao_geral', v_visao,
    'login', v_login
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.marca_condominio(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS storage_marca_anon ON storage.objects;
CREATE POLICY storage_marca_anon ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'condominios'
    AND split_part(name, '/', 2) = 'marca'
  );

NOTIFY pgrst, 'reload schema';
