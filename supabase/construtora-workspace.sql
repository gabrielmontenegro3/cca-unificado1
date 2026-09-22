-- Construtora acompanha ocorrências (somente leitura) e fala no chat do laudo.
-- Rode o ARQUIVO INTEIRO no SQL Editor (Run and enable RLS).

CREATE OR REPLACE FUNCTION public.user_is_construtora(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_cargo_tipo(cid) = 'construtora'::public.tipo_cargo
    OR public.user_is_construtora_org_do_condominio(cid);
$$;

GRANT EXECUTE ON FUNCTION public.user_is_construtora(uuid) TO authenticated;

DROP POLICY IF EXISTS ch_select ON public.chamados;
CREATE POLICY ch_select ON public.chamados
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
    OR solicitante_id = auth.uid()
    OR public.user_is_construtora(condominio_id)
    OR (
      public.user_cargo_tipo(condominio_id) = 'administracao'::public.tipo_cargo
      AND public.chamado_eh_da_administracao(id)
    )
  );

DROP POLICY IF EXISTS ca_select ON public.chamado_arquivos;
CREATE POLICY ca_select ON public.chamado_arquivos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chamados c
      WHERE c.id = chamado_id
        AND (
          public.user_is_gestao_tecnica()
          OR public.user_is_gestao(c.condominio_id)
          OR c.solicitante_id = auth.uid()
          OR public.user_is_construtora(c.condominio_id)
          OR (
            public.user_cargo_tipo(c.condominio_id) = 'administracao'::public.tipo_cargo
            AND public.chamado_eh_da_administracao(c.id)
          )
          OR EXISTS (
            SELECT 1 FROM public.conversas cv
            WHERE cv.chamado_id = c.id AND public.user_participates(cv.id)
          )
        )
    )
  );

DROP POLICY IF EXISTS conv_select ON public.conversas;
CREATE POLICY conv_select ON public.conversas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversa_participantes cp
      WHERE cp.conversa_id = conversas.id
        AND cp.usuario_id = auth.uid()
        AND cp.saiu_em IS NULL
    )
    OR public.user_is_gestao_tecnica()
    OR EXISTS (
      SELECT 1 FROM public.chamados c
      WHERE c.id = chamado_id AND c.solicitante_id = auth.uid()
    )
    OR (tipo = 'laudo' AND public.pode_ver_laudo(condominio_id))
    OR (
      COALESCE(tipo, 'chamado') <> 'laudo'
      AND public.user_is_construtora(COALESCE(
        condominio_id,
        (SELECT c.condominio_id FROM public.chamados c WHERE c.id = chamado_id)
      ))
    )
    OR (
      COALESCE(tipo, 'chamado') <> 'laudo'
      AND public.user_cargo_tipo(COALESCE(
        condominio_id,
        (SELECT c.condominio_id FROM public.chamados c WHERE c.id = chamado_id)
      )) = 'administracao'::public.tipo_cargo
      AND public.chamado_eh_da_administracao(chamado_id)
    )
  );

DROP POLICY IF EXISTS msg_select ON public.mensagens;
CREATE POLICY msg_select ON public.mensagens
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversa_participantes cp
      WHERE cp.conversa_id = mensagens.conversa_id
        AND cp.usuario_id = auth.uid()
        AND cp.saiu_em IS NULL
    )
    OR public.user_is_gestao_tecnica()
    OR EXISTS (
      SELECT 1 FROM public.conversas cv
      JOIN public.chamados c ON c.id = cv.chamado_id
      WHERE cv.id = mensagens.conversa_id
        AND c.solicitante_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.conversas cv
      WHERE cv.id = mensagens.conversa_id
        AND cv.tipo = 'laudo'
        AND public.pode_ver_laudo(cv.condominio_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.conversas cv
      LEFT JOIN public.chamados c ON c.id = cv.chamado_id
      WHERE cv.id = mensagens.conversa_id
        AND COALESCE(cv.tipo, 'chamado') <> 'laudo'
        AND public.user_is_construtora(COALESCE(cv.condominio_id, c.condominio_id))
    )
  );

DROP POLICY IF EXISTS marq_select ON public.mensagem_arquivos;
CREATE POLICY marq_select ON public.mensagem_arquivos
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR EXISTS (
      SELECT 1 FROM public.mensagens m
      WHERE m.id = mensagem_id AND m.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.mensagens m
      JOIN public.conversas cv ON cv.id = m.conversa_id
      JOIN public.chamados c ON c.id = cv.chamado_id
      WHERE m.id = mensagem_id AND c.solicitante_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.mensagens m
      JOIN public.conversas cv ON cv.id = m.conversa_id
      WHERE m.id = mensagem_id
        AND cv.tipo = 'laudo'
        AND public.pode_ver_laudo(cv.condominio_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.mensagens m
      JOIN public.conversas cv ON cv.id = m.conversa_id
      LEFT JOIN public.chamados c ON c.id = cv.chamado_id
      WHERE m.id = mensagem_id
        AND COALESCE(cv.tipo, 'chamado') <> 'laudo'
        AND public.user_is_construtora(COALESCE(cv.condominio_id, c.condominio_id))
    )
  );

CREATE OR REPLACE FUNCTION public.listar_mensagens_chamado_watch(p_chamado_id uuid)
RETURNS SETOF public.mensagens
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_condo uuid;
BEGIN
  IF auth.uid() IS NULL OR p_chamado_id IS NULL THEN
    RETURN;
  END IF;

  SELECT condominio_id INTO v_condo
  FROM public.chamados
  WHERE id = p_chamado_id;

  IF v_condo IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    public.user_is_gestao_tecnica()
    OR public.user_is_construtora(v_condo)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.*
  FROM public.mensagens m
  JOIN public.conversas cv ON cv.id = m.conversa_id
  WHERE cv.chamado_id = p_chamado_id
    AND COALESCE(cv.tipo, 'chamado') <> 'laudo'
    AND cv.laudo_id IS NULL
  ORDER BY m.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_mensagens_chamado_watch(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
