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
    OR public.user_is_staff(condominio_id)
    OR solicitante_id = auth.uid()
    OR public.user_is_construtora(condominio_id)
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
          OR public.user_is_staff(c.condominio_id)
          OR c.solicitante_id = auth.uid()
          OR public.user_is_construtora(c.condominio_id)
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
      AND public.user_is_construtora(condominio_id)
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
      WHERE cv.id = mensagens.conversa_id
        AND COALESCE(cv.tipo, 'chamado') <> 'laudo'
        AND public.user_is_construtora(cv.condominio_id)
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
      WHERE m.id = mensagem_id
        AND COALESCE(cv.tipo, 'chamado') <> 'laudo'
        AND public.user_is_construtora(cv.condominio_id)
    )
  );

NOTIFY pgrst, 'reload schema';
