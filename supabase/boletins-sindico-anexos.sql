-- Boletins: o síndico (administração do condomínio) também publica,
-- e cada boletim pode ter arquivos ou imagens anexados.
-- Pré-requisito: supabase/boletins-rls-fix.sql já rodado.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

-- 1) Quem gere boletins: Gestão Técnica, administrador, admin do sistema e síndico.
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
    OR public.user_cargo_tipo(cid) = 'administracao'::public.tipo_cargo
    OR COALESCE((
      SELECT u.admin_sistema
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.ativo IS TRUE
    ), FALSE);
$$;

REVOKE ALL ON FUNCTION public.pode_gerir_boletim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_gerir_boletim(uuid) TO authenticated, service_role;

-- 2) Arquivos de cada boletim.
CREATE TABLE IF NOT EXISTS public.boletim_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boletim_id uuid NOT NULL REFERENCES public.boletins_informativos(id) ON DELETE CASCADE,
  arquivo_id uuid NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE,
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (boletim_id, arquivo_id)
);

CREATE INDEX IF NOT EXISTS boletim_anexos_boletim_idx
  ON public.boletim_anexos (boletim_id, ordem);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.boletim_anexos TO authenticated;
ALTER TABLE public.boletim_anexos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banx_select ON public.boletim_anexos;
DROP POLICY IF EXISTS banx_write ON public.boletim_anexos;
-- Morador vê os anexos só de boletins publicados.
CREATE POLICY banx_select ON public.boletim_anexos
  FOR SELECT TO authenticated
  USING (
    public.pode_gerir_boletim(condominio_id)
    OR (
      public.user_belongs_to_condominio(condominio_id)
      AND EXISTS (
        SELECT 1 FROM public.boletins_informativos b
        WHERE b.id = boletim_id AND b.publicado IS TRUE
      )
    )
  );
CREATE POLICY banx_write ON public.boletim_anexos
  FOR ALL TO authenticated
  USING (public.pode_gerir_boletim(condominio_id))
  WITH CHECK (public.pode_gerir_boletim(condominio_id));

-- 3) Criar boletim agora aceita anexos. Com anexo, o texto fica opcional.
DROP FUNCTION IF EXISTS public.criar_boletim(uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.criar_boletim(uuid, text, text, text, boolean, uuid[]);

CREATE FUNCTION public.criar_boletim(
  p_condominio_id uuid,
  p_titulo text,
  p_subtitulo text DEFAULT NULL,
  p_texto text DEFAULT NULL,
  p_publicado boolean DEFAULT FALSE,
  p_arquivos uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id uuid;
  v_titulo text := trim(COALESCE(p_titulo, ''));
  v_texto text := trim(COALESCE(p_texto, ''));
  v_sub text := NULLIF(trim(COALESCE(p_subtitulo, '')), '');
  v_pub boolean := COALESCE(p_publicado, FALSE);
  v_tem_anexo boolean := p_arquivos IS NOT NULL AND COALESCE(array_length(p_arquivos, 1), 0) > 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_condominio_id IS NULL OR v_titulo = '' THEN
    RAISE EXCEPTION 'Informe o título do boletim';
  END IF;
  IF v_texto = '' AND NOT v_tem_anexo THEN
    RAISE EXCEPTION 'Escreva o texto ou anexe um arquivo ao boletim';
  END IF;
  IF NOT public.pode_gerir_boletim(p_condominio_id) THEN
    RAISE EXCEPTION 'Somente o síndico, o administrador e a Gestão Técnica publicam boletins';
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

  -- Só vincula arquivos do próprio condomínio.
  IF v_tem_anexo THEN
    INSERT INTO public.boletim_anexos (boletim_id, arquivo_id, condominio_id, ordem)
    SELECT v_id, a.id, p_condominio_id, (x.ord - 1)::int
    FROM unnest(p_arquivos) WITH ORDINALITY AS x(arquivo_id, ord)
    JOIN public.arquivos a ON a.id = x.arquivo_id AND a.condominio_id = p_condominio_id
    ON CONFLICT (boletim_id, arquivo_id) DO NOTHING;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_boletim(uuid, text, text, text, boolean, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_boletim(uuid, text, text, text, boolean, uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
