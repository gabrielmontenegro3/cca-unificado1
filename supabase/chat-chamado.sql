-- Chat do chamado. Rode o ARQUIVO INTEIRO (não selecione trecho).

GRANT SELECT, INSERT, UPDATE ON TABLE public.conversas TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.conversa_participantes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mensagens TO authenticated;
GRANT SELECT, INSERT ON TABLE public.mensagem_arquivos TO authenticated;

DROP POLICY IF EXISTS conv_select ON public.conversas;
DROP POLICY IF EXISTS conv_insert ON public.conversas;
DROP POLICY IF EXISTS cp_select ON public.conversa_participantes;
DROP POLICY IF EXISTS cp_insert ON public.conversa_participantes;
DROP POLICY IF EXISTS cp_update ON public.conversa_participantes;
DROP POLICY IF EXISTS msg_select ON public.mensagens;
DROP POLICY IF EXISTS msg_insert ON public.mensagens;

CREATE OR REPLACE FUNCTION public.user_participates(conversa uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.conversa_participantes cp
    WHERE cp.conversa_id = conversa
      AND cp.usuario_id = auth.uid()
      AND cp.saiu_em IS NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pode_falar_no_chamado(p_chamado_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.chamados c
    WHERE c.id = p_chamado_id
      AND (
        c.solicitante_id = auth.uid()
        OR public.user_is_gestao_tecnica()
        OR public.user_is_staff(c.condominio_id)
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.garantir_chat_chamado(p_chamado_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ch public.chamados;
  v_conv uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.pode_falar_no_chamado(p_chamado_id) THEN
    RAISE EXCEPTION 'Sem permissão para o chat deste chamado';
  END IF;

  SELECT * INTO v_ch FROM public.chamados WHERE id = p_chamado_id;
  IF v_ch.id IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado';
  END IF;

  SELECT id INTO v_conv FROM public.conversas WHERE chamado_id = p_chamado_id LIMIT 1;
  IF v_conv IS NULL THEN
    INSERT INTO public.conversas (condominio_id, tipo, titulo, chamado_id)
    VALUES (v_ch.condominio_id, 'chamado', v_ch.titulo, v_ch.id)
    RETURNING id INTO v_conv;
  END IF;

  INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
  VALUES (v_conv, auth.uid())
  ON CONFLICT (conversa_id, usuario_id) DO UPDATE
    SET saiu_em = NULL;

  RETURN v_conv;
END;
$$;

CREATE OR REPLACE FUNCTION public.enviar_mensagem_chamado(p_chamado_id uuid, p_texto text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv uuid;
  v_msg public.mensagens;
BEGIN
  IF p_texto IS NULL OR length(trim(p_texto)) = 0 THEN
    RAISE EXCEPTION 'Escreva a mensagem';
  END IF;

  v_conv := public.garantir_chat_chamado(p_chamado_id);

  INSERT INTO public.mensagens (conversa_id, usuario_id, texto)
  VALUES (v_conv, auth.uid(), trim(p_texto))
  RETURNING * INTO v_msg;

  RETURN to_jsonb(v_msg);
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_participates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_falar_no_chamado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.garantir_chat_chamado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_mensagem_chamado(uuid, text) TO authenticated;

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
  );

CREATE POLICY conv_insert ON public.conversas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR EXISTS (
      SELECT 1 FROM public.chamados c
      WHERE c.id = chamado_id AND c.solicitante_id = auth.uid()
    )
  );

CREATE POLICY cp_select ON public.conversa_participantes
  FOR SELECT TO authenticated
  USING (
    usuario_id = auth.uid()
    OR public.user_is_gestao_tecnica()
  );

CREATE POLICY cp_insert ON public.conversa_participantes
  FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY cp_update ON public.conversa_participantes
  FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

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
  );

CREATE POLICY msg_insert ON public.mensagens
  FOR INSERT TO authenticated
  WITH CHECK (
    usuario_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.conversa_participantes cp
        WHERE cp.conversa_id = mensagens.conversa_id
          AND cp.usuario_id = auth.uid()
          AND cp.saiu_em IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.conversas cv
        JOIN public.chamados c ON c.id = cv.chamado_id
        WHERE cv.id = mensagens.conversa_id
          AND (
            c.solicitante_id = auth.uid()
            OR public.user_is_gestao_tecnica()
          )
      )
    )
  );

DROP POLICY IF EXISTS marq_select ON public.mensagem_arquivos;
DROP POLICY IF EXISTS marq_insert ON public.mensagem_arquivos;
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
  );
CREATE POLICY marq_insert ON public.mensagem_arquivos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mensagens m
      WHERE m.id = mensagem_id AND m.usuario_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
