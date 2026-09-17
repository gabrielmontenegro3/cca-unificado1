-- Corrige INSERT em boletins_informativos (RLS).
-- Rode o ARQUIVO INTEIRO no SQL Editor.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.boletins_informativos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.boletim_arquivos TO authenticated;

CREATE OR REPLACE FUNCTION public.pode_gerir_boletim(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(cid)
    OR COALESCE((
      SELECT u.admin_sistema
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.ativo IS TRUE
    ), FALSE);
$$;

DROP POLICY IF EXISTS bol_select ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_write ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_insert ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_update ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_delete ON public.boletins_informativos;

CREATE POLICY bol_select ON public.boletins_informativos
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    AND (
      publicado IS TRUE
      OR autor_id = auth.uid()
      OR public.pode_gerir_boletim(condominio_id)
    )
  );

CREATE POLICY bol_insert ON public.boletins_informativos
  FOR INSERT TO authenticated
  WITH CHECK (
    (autor_id IS NULL OR autor_id = auth.uid())
    AND public.pode_gerir_boletim(condominio_id)
  );

CREATE POLICY bol_update ON public.boletins_informativos
  FOR UPDATE TO authenticated
  USING (public.pode_gerir_boletim(condominio_id))
  WITH CHECK (public.pode_gerir_boletim(condominio_id));

CREATE POLICY bol_delete ON public.boletins_informativos
  FOR DELETE TO authenticated
  USING (public.pode_gerir_boletim(condominio_id));

CREATE OR REPLACE FUNCTION public.criar_boletim(
  p_condominio_id uuid,
  p_titulo text,
  p_subtitulo text DEFAULT NULL,
  p_texto text DEFAULT NULL,
  p_publicado boolean DEFAULT FALSE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_titulo text := trim(COALESCE(p_titulo, ''));
  v_texto text := trim(COALESCE(p_texto, ''));
  v_sub text := NULLIF(trim(COALESCE(p_subtitulo, '')), '');
  v_pub boolean := COALESCE(p_publicado, FALSE);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_condominio_id IS NULL OR v_titulo = '' OR v_texto = '' THEN
    RAISE EXCEPTION 'Informe título e texto do boletim';
  END IF;
  IF NOT public.pode_gerir_boletim(p_condominio_id) THEN
    RAISE EXCEPTION 'Somente o administrador e a Gestão Técnica publicam boletins';
  END IF;

  INSERT INTO public.boletins_informativos (
    condominio_id,
    autor_id,
    titulo,
    subtitulo,
    texto,
    publicado,
    data_publicacao
  ) VALUES (
    p_condominio_id,
    auth.uid(),
    v_titulo,
    v_sub,
    v_texto,
    v_pub,
    CASE WHEN v_pub THEN NOW() ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pode_gerir_boletim(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_boletim(uuid, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_gerir_boletim(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.criar_boletim(uuid, text, text, text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
