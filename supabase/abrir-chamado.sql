-- Chamado só pelo morador, com a unidade do cadastro dele.
-- Cria user_is_staff se faltar. Rode o ARQUIVO INTEIRO.

GRANT SELECT ON TABLE public.cargos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chamados TO authenticated;
GRANT SELECT, INSERT ON TABLE public.chamado_status_historico TO authenticated;
GRANT SELECT, INSERT ON TABLE public.conversas TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.conversa_participantes TO authenticated;
GRANT SELECT, INSERT ON TABLE public.chamado_arquivos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mensagens TO authenticated;
GRANT SELECT, INSERT ON TABLE public.mensagem_arquivos TO authenticated;

CREATE OR REPLACE FUNCTION public.user_belongs_to_condominio(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
  OR EXISTS (
    SELECT 1
    FROM public.usuario_condominio uc
    WHERE uc.usuario_id = auth.uid()
      AND uc.condominio_id = cid
      AND uc.ativo IS TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.user_cargo_tipo(cid uuid)
RETURNS public.tipo_cargo
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.user_is_gestao_tecnica() THEN 'gestao_tecnica'::public.tipo_cargo
    ELSE (
      SELECT c.tipo
      FROM public.usuario_condominio uc
      JOIN public.cargos c ON c.id = uc.cargo_id
      WHERE uc.usuario_id = auth.uid()
        AND uc.condominio_id = cid
        AND uc.ativo IS TRUE
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_staff(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
  OR public.user_cargo_tipo(cid) IN (
    'administrador'::public.tipo_cargo,
    'gestao_tecnica'::public.tipo_cargo,
    'administracao'::public.tipo_cargo
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_gestao(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
  OR public.user_cargo_tipo(cid) IN (
    'administrador'::public.tipo_cargo,
    'gestao_tecnica'::public.tipo_cargo
  );
$$;

CREATE OR REPLACE FUNCTION public.user_participates(conversa uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversa_participantes cp
    WHERE cp.conversa_id = conversa
      AND cp.usuario_id = auth.uid()
      AND cp.saiu_em IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_belongs_to_condominio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_cargo_tipo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_gestao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_participates(uuid) TO authenticated;

DROP POLICY IF EXISTS ch_select ON public.chamados;
DROP POLICY IF EXISTS ch_insert ON public.chamados;
DROP POLICY IF EXISTS ch_update ON public.chamados;

CREATE POLICY ch_select ON public.chamados
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_staff(condominio_id)
    OR solicitante_id = auth.uid()
  );

CREATE POLICY ch_insert ON public.chamados
  FOR INSERT TO authenticated
  WITH CHECK (
    solicitante_id = auth.uid()
    AND public.user_cargo_tipo(condominio_id) = 'morador'::public.tipo_cargo
  );

CREATE POLICY ch_update ON public.chamados
  FOR UPDATE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
    OR public.user_is_staff(condominio_id)
  )
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
    OR public.user_is_staff(condominio_id)
  );

DROP FUNCTION IF EXISTS public.abrir_chamado(uuid, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.abrir_chamado(uuid, text, text);

CREATE OR REPLACE FUNCTION public.abrir_chamado(
  p_condominio_id uuid,
  p_titulo text,
  p_descricao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.chamados;
  v_cargo public.tipo_cargo;
  v_unidade uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_titulo IS NULL OR length(trim(p_titulo)) < 2 THEN
    RAISE EXCEPTION 'Informe o título do chamado';
  END IF;

  v_cargo := public.user_cargo_tipo(p_condominio_id);
  IF v_cargo IS DISTINCT FROM 'morador'::public.tipo_cargo THEN
    RAISE EXCEPTION 'Somente o morador pode abrir chamado';
  END IF;

  SELECT um.unidade_id INTO v_unidade
  FROM public.unidade_moradores um
  JOIN public.unidades u ON u.id = um.unidade_id
  WHERE um.usuario_id = auth.uid()
    AND u.condominio_id = p_condominio_id
  LIMIT 1;

  IF v_unidade IS NULL THEN
    RAISE EXCEPTION 'Seu cadastro não tem unidade. Peça à Gestão Técnica para informar bloco/casa ou apto.';
  END IF;

  INSERT INTO public.chamados (
    condominio_id, solicitante_id, unidade_id, titulo, descricao, status, prioridade
  ) VALUES (
    p_condominio_id,
    auth.uid(),
    v_unidade,
    trim(p_titulo),
    NULLIF(trim(COALESCE(p_descricao, '')), ''),
    'aberto',
    'normal'
  )
  RETURNING * INTO v_row;

  INSERT INTO public.chamado_status_historico (
    chamado_id, status_anterior, status_novo, alterado_por, observacao
  ) VALUES (
    v_row.id, NULL, 'aberto', auth.uid(), 'Chamado aberto'
  );

  INSERT INTO public.conversas (condominio_id, tipo, titulo, chamado_id)
  VALUES (p_condominio_id, 'chamado', v_row.titulo, v_row.id);

  INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
  SELECT cv.id, v_row.solicitante_id
  FROM public.conversas cv
  WHERE cv.chamado_id = v_row.id
  ON CONFLICT (conversa_id, usuario_id) DO NOTHING;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.minha_unidade(p_condominio_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(x)
  FROM (
    SELECT
      u.id,
      u.identificacao,
      u.bloco,
      CASE
        WHEN COALESCE(u.bloco, '') <> '' THEN 'Bloco ' || u.bloco || ' / ' || u.identificacao
        ELSE u.identificacao
      END AS rotulo
    FROM public.unidade_moradores um
    JOIN public.unidades u ON u.id = um.unidade_id
    WHERE um.usuario_id = auth.uid()
      AND u.condominio_id = p_condominio_id
    LIMIT 1
  ) x;
$$;

CREATE OR REPLACE FUNCTION public.after_conversa_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tipo = 'chamado' THEN
    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT NEW.id, c.solicitante_id
    FROM public.chamados c
    WHERE c.id = NEW.chamado_id
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;

    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT NEW.id, uc.usuario_id
    FROM public.usuario_condominio uc
    JOIN public.cargos cg ON cg.id = uc.cargo_id
    WHERE uc.condominio_id = NEW.condominio_id
      AND uc.ativo IS TRUE
      AND cg.tipo IN (
        'gestao_tecnica'::public.tipo_cargo,
        'administrador'::public.tipo_cargo,
        'administracao'::public.tipo_cargo
      )
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;

    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT NEW.id, u.id
    FROM public.usuarios u
    WHERE u.gestao_tecnica IS TRUE
      AND u.ativo IS TRUE
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;
    ELSIF NEW.tipo = 'laudo' THEN
    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT NEW.id, uc.usuario_id
    FROM public.usuario_condominio uc
    JOIN public.cargos cg ON cg.id = uc.cargo_id
    WHERE uc.condominio_id = NEW.condominio_id
      AND uc.ativo IS TRUE
      AND cg.tipo IN (
        'gestao_tecnica'::public.tipo_cargo,
        'construtora'::public.tipo_cargo
      )
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;

    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT NEW.id, u.id
    FROM public.usuarios u
    WHERE u.gestao_tecnica IS TRUE
      AND u.ativo IS TRUE
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pode_falar_no_chamado(p_chamado_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chamados c
    WHERE c.id = p_chamado_id
      AND (
        c.solicitante_id = auth.uid()
        OR public.user_is_gestao_tecnica()
        OR public.user_is_staff(c.condominio_id)
      )
  );
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

DROP TRIGGER IF EXISTS trg_conversa_participantes ON public.conversas;
CREATE TRIGGER trg_conversa_participantes
AFTER INSERT ON public.conversas
FOR EACH ROW
EXECUTE PROCEDURE public.after_conversa_insert();

DROP POLICY IF EXISTS conv_select ON public.conversas;
CREATE POLICY conv_select ON public.conversas
  FOR SELECT TO authenticated
  USING (
    public.user_participates(id)
    OR public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
    OR public.user_is_staff(condominio_id)
    OR EXISTS (
      SELECT 1 FROM public.chamados c
      WHERE c.id = chamado_id AND c.solicitante_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS msg_select ON public.mensagens;
DROP POLICY IF EXISTS msg_insert ON public.mensagens;
CREATE POLICY msg_select ON public.mensagens
  FOR SELECT TO authenticated
  USING (
    public.user_participates(conversa_id)
    OR EXISTS (
      SELECT 1 FROM public.conversas cv
      WHERE cv.id = conversa_id
        AND (
          public.user_is_gestao_tecnica()
          OR public.user_is_staff(cv.condominio_id)
          OR EXISTS (
            SELECT 1 FROM public.chamados c
            WHERE c.id = cv.chamado_id AND c.solicitante_id = auth.uid()
          )
        )
    )
  );
CREATE POLICY msg_insert ON public.mensagens
  FOR INSERT TO authenticated
  WITH CHECK (
    usuario_id = auth.uid()
    AND (
      public.user_participates(conversa_id)
      OR EXISTS (
        SELECT 1 FROM public.conversas cv
        JOIN public.chamados c ON c.id = cv.chamado_id
        WHERE cv.id = conversa_id
          AND public.pode_falar_no_chamado(c.id)
      )
    )
  );

GRANT EXECUTE ON FUNCTION public.abrir_chamado(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minha_unidade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_falar_no_chamado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.garantir_chat_chamado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_mensagem_chamado(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
