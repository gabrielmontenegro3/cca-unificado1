-- Chat do laudo: Gestão Técnica e Construtora falam.
-- Administração só vê. Morador não acessa. Só a GT cria o laudo.
-- Rode o ARQUIVO INTEIRO.

GRANT SELECT, INSERT, UPDATE ON TABLE public.laudos_tecnicos TO authenticated;
GRANT SELECT, INSERT ON TABLE public.laudo_arquivos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.conversas TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.conversa_participantes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mensagens TO authenticated;
GRANT SELECT, INSERT ON TABLE public.mensagem_arquivos TO authenticated;

CREATE OR REPLACE FUNCTION public.user_is_construtora(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_cargo_tipo(cid) = 'construtora'::public.tipo_cargo;
$$;

CREATE OR REPLACE FUNCTION public.pode_ver_laudo(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
    OR public.user_is_staff(cid)
    OR public.user_is_construtora(cid);
$$;

CREATE OR REPLACE FUNCTION public.pode_falar_no_laudo(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
    OR public.user_is_construtora(cid);
$$;

GRANT EXECUTE ON FUNCTION public.user_is_construtora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_ver_laudo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_falar_no_laudo(uuid) TO authenticated;

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

DELETE FROM public.conversa_participantes cp
USING public.conversas cv
WHERE cp.conversa_id = cv.id
  AND cv.tipo = 'laudo'
  AND EXISTS (
    SELECT 1
    FROM public.usuario_condominio uc
    JOIN public.cargos cg ON cg.id = uc.cargo_id
    WHERE uc.usuario_id = cp.usuario_id
      AND uc.condominio_id = cv.condominio_id
      AND uc.ativo IS TRUE
      AND cg.tipo IN ('administracao'::public.tipo_cargo, 'administrador'::public.tipo_cargo)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = cp.usuario_id AND u.gestao_tecnica IS TRUE
  );

CREATE OR REPLACE FUNCTION public.garantir_chat_laudo(p_laudo_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_laudo public.laudos_tecnicos;
  v_conv uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO v_laudo FROM public.laudos_tecnicos WHERE id = p_laudo_id;
  IF v_laudo.id IS NULL THEN
    RAISE EXCEPTION 'Laudo não encontrado';
  END IF;
  IF NOT public.pode_ver_laudo(v_laudo.condominio_id) THEN
    RAISE EXCEPTION 'Sem permissão para ver este laudo';
  END IF;

  SELECT id INTO v_conv FROM public.conversas WHERE laudo_id = p_laudo_id LIMIT 1;
  IF v_conv IS NULL THEN
    INSERT INTO public.conversas (condominio_id, tipo, titulo, laudo_id, chamado_id)
    VALUES (v_laudo.condominio_id, 'laudo', v_laudo.titulo, v_laudo.id, v_laudo.chamado_id)
    RETURNING id INTO v_conv;
  END IF;

  IF public.pode_falar_no_laudo(v_laudo.condominio_id) THEN
    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    VALUES (v_conv, auth.uid())
    ON CONFLICT (conversa_id, usuario_id) DO UPDATE
      SET saiu_em = NULL;
  END IF;

  RETURN v_conv;
END;
$$;

CREATE OR REPLACE FUNCTION public.enviar_mensagem_laudo(p_laudo_id uuid, p_texto text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_laudo public.laudos_tecnicos;
  v_conv uuid;
  v_msg public.mensagens;
BEGIN
  IF p_texto IS NULL OR length(trim(p_texto)) = 0 THEN
    RAISE EXCEPTION 'Escreva a mensagem';
  END IF;

  SELECT * INTO v_laudo FROM public.laudos_tecnicos WHERE id = p_laudo_id;
  IF v_laudo.id IS NULL THEN
    RAISE EXCEPTION 'Laudo não encontrado';
  END IF;
  IF NOT public.pode_falar_no_laudo(v_laudo.condominio_id) THEN
    RAISE EXCEPTION 'Somente Gestão Técnica e Construtora enviam mensagens neste chat';
  END IF;

  v_conv := public.garantir_chat_laudo(p_laudo_id);

  INSERT INTO public.mensagens (conversa_id, usuario_id, texto)
  VALUES (v_conv, auth.uid(), trim(p_texto))
  RETURNING * INTO v_msg;

  RETURN to_jsonb(v_msg);
END;
$$;

GRANT EXECUTE ON FUNCTION public.garantir_chat_laudo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_mensagem_laudo(uuid, text) TO authenticated;

DROP POLICY IF EXISTS lau_select ON public.laudos_tecnicos;
DROP POLICY IF EXISTS lau_insert ON public.laudos_tecnicos;
DROP POLICY IF EXISTS lau_update ON public.laudos_tecnicos;
CREATE POLICY lau_select ON public.laudos_tecnicos
  FOR SELECT TO authenticated
  USING (public.pode_ver_laudo(condominio_id));
CREATE POLICY lau_insert ON public.laudos_tecnicos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_is_gestao_tecnica()
    AND criado_por = auth.uid()
  );
CREATE POLICY lau_update ON public.laudos_tecnicos
  FOR UPDATE TO authenticated
  USING (public.user_is_gestao_tecnica())
  WITH CHECK (public.user_is_gestao_tecnica());

DROP POLICY IF EXISTS la_select ON public.laudo_arquivos;
DROP POLICY IF EXISTS la_insert ON public.laudo_arquivos;
CREATE POLICY la_select ON public.laudo_arquivos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.laudos_tecnicos l
      WHERE l.id = laudo_id AND public.pode_ver_laudo(l.condominio_id)
    )
  );
CREATE POLICY la_insert ON public.laudo_arquivos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.laudos_tecnicos l
      WHERE l.id = laudo_id AND public.user_is_gestao_tecnica()
    )
  );

DROP POLICY IF EXISTS cp_insert ON public.conversa_participantes;
DROP POLICY IF EXISTS cp_update ON public.conversa_participantes;
CREATE POLICY cp_insert ON public.conversa_participantes
  FOR INSERT TO authenticated
  WITH CHECK (
    usuario_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversas cv
      WHERE cv.id = conversa_id
        AND (
          (cv.tipo = 'laudo' AND public.pode_falar_no_laudo(cv.condominio_id))
          OR (COALESCE(cv.tipo, 'chamado') <> 'laudo')
        )
    )
  );
CREATE POLICY cp_update ON public.conversa_participantes
  FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

DROP POLICY IF EXISTS conv_select ON public.conversas;
DROP POLICY IF EXISTS conv_insert ON public.conversas;
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

DROP POLICY IF EXISTS msg_select ON public.mensagens;
DROP POLICY IF EXISTS msg_insert ON public.mensagens;
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
  );
CREATE POLICY msg_insert ON public.mensagens
  FOR INSERT TO authenticated
  WITH CHECK (
    usuario_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversas cv
      WHERE cv.id = mensagens.conversa_id
        AND (
          (
            COALESCE(cv.tipo, 'chamado') = 'chamado'
            AND (
              public.pode_falar_no_chamado(cv.chamado_id)
              OR EXISTS (
                SELECT 1 FROM public.conversa_participantes cp
                WHERE cp.conversa_id = cv.id
                  AND cp.usuario_id = auth.uid()
                  AND cp.saiu_em IS NULL
              )
            )
          )
          OR (cv.tipo = 'laudo' AND public.pode_falar_no_laudo(cv.condominio_id))
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
    OR EXISTS (
      SELECT 1 FROM public.mensagens m
      JOIN public.conversas cv ON cv.id = m.conversa_id
      WHERE m.id = mensagem_id
        AND cv.tipo = 'laudo'
        AND public.pode_ver_laudo(cv.condominio_id)
    )
  );
CREATE POLICY marq_insert ON public.mensagem_arquivos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mensagens m
      JOIN public.conversas cv ON cv.id = m.conversa_id
      WHERE m.id = mensagem_id
        AND m.usuario_id = auth.uid()
        AND (
          COALESCE(cv.tipo, 'chamado') <> 'laudo'
          OR public.pode_falar_no_laudo(cv.condominio_id)
        )
    )
  );

NOTIFY pgrst, 'reload schema';
