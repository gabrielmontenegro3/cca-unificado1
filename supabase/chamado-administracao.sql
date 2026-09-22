-- Administração do condomínio (síndico) abre chamado e só vê os da administração.
-- Todos os usuários administração do mesmo condomínio compartilham esses chamados.
-- Morador continua com a fila própria. Rode o ARQUIVO INTEIRO no SQL Editor.

ALTER TABLE public.chamados
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'morador';

CREATE OR REPLACE FUNCTION public.user_is_administracao(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_cargo_tipo(cid) = 'administracao'::public.tipo_cargo;
$$;

CREATE OR REPLACE FUNCTION public.chamado_eh_da_administracao(p_chamado_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chamados c
    LEFT JOIN public.unidades u ON u.id = c.unidade_id
    WHERE c.id = p_chamado_id
      AND (
        COALESCE(c.origem, '') = 'administracao'
        OR lower(trim(COALESCE(u.identificacao, ''))) IN (
          'áreas comuns', 'areas comuns', 'área comum', 'area comum'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.garantir_unidade_areas_comuns(p_condominio_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_condominio_id IS NULL THEN
    RAISE EXCEPTION 'Condomínio inválido';
  END IF;

  SELECT u.id INTO v_id
  FROM public.unidades u
  WHERE u.condominio_id = p_condominio_id
    AND lower(trim(u.identificacao)) IN ('áreas comuns', 'areas comuns', 'área comum', 'area comum')
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.unidades (condominio_id, identificacao)
    VALUES (p_condominio_id, 'Áreas comuns')
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

INSERT INTO public.unidades (condominio_id, identificacao)
SELECT c.id, 'Áreas comuns'
FROM public.condominios c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.unidades u
  WHERE u.condominio_id = c.id
    AND lower(trim(u.identificacao)) IN ('áreas comuns', 'areas comuns', 'área comum', 'area comum')
);

DO $$
BEGIN
  IF to_regprocedure('public.user_is_construtora(uuid)') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.user_is_construtora(cid uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$
        SELECT public.user_cargo_tipo(cid) = 'construtora'::public.tipo_cargo
      $body$;
    $fn$;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.user_is_construtora(uuid) TO authenticated;

UPDATE public.chamados c
SET origem = 'administracao'
WHERE COALESCE(c.origem, '') <> 'administracao'
  AND (
    EXISTS (
      SELECT 1
      FROM public.usuario_condominio uc
      JOIN public.cargos cg ON cg.id = uc.cargo_id
      WHERE uc.usuario_id = c.solicitante_id
        AND uc.condominio_id = c.condominio_id
        AND uc.ativo IS TRUE
        AND cg.tipo = 'administracao'::public.tipo_cargo
    )
    OR EXISTS (
      SELECT 1
      FROM public.unidades u
      WHERE u.id = c.unidade_id
        AND lower(trim(u.identificacao)) IN ('áreas comuns', 'areas comuns', 'área comum', 'area comum')
    )
  );

DROP POLICY IF EXISTS ch_select ON public.chamados;
DROP POLICY IF EXISTS ch_insert ON public.chamados;

CREATE POLICY ch_select ON public.chamados
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
    OR solicitante_id = auth.uid()
    OR public.user_is_construtora(condominio_id)
    OR (
      public.user_is_administracao(condominio_id)
      AND public.chamado_eh_da_administracao(id)
    )
  );

CREATE POLICY ch_insert ON public.chamados
  FOR INSERT TO authenticated
  WITH CHECK (
    solicitante_id = auth.uid()
    AND public.user_cargo_tipo(condominio_id) IN (
      'morador'::public.tipo_cargo,
      'administracao'::public.tipo_cargo
    )
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
  v_origem text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_titulo IS NULL OR length(trim(p_titulo)) < 2 THEN
    RAISE EXCEPTION 'Informe o título do chamado';
  END IF;

  v_cargo := public.user_cargo_tipo(p_condominio_id);
  IF v_cargo IS DISTINCT FROM 'morador'::public.tipo_cargo
     AND v_cargo IS DISTINCT FROM 'administracao'::public.tipo_cargo THEN
    RAISE EXCEPTION 'Somente o morador ou a Administração do condomínio podem abrir chamado';
  END IF;

  IF v_cargo = 'administracao'::public.tipo_cargo THEN
    v_unidade := public.garantir_unidade_areas_comuns(p_condominio_id);
    v_origem := 'administracao';
  ELSE
    SELECT um.unidade_id INTO v_unidade
    FROM public.unidade_moradores um
    JOIN public.unidades u ON u.id = um.unidade_id
    WHERE um.usuario_id = auth.uid()
      AND u.condominio_id = p_condominio_id
    LIMIT 1;
    v_origem := 'morador';
  END IF;

  IF v_unidade IS NULL THEN
    RAISE EXCEPTION 'Seu cadastro não tem unidade. Peça à Gestão Técnica para informar bloco/casa ou apto.';
  END IF;

  INSERT INTO public.chamados (
    condominio_id, solicitante_id, unidade_id, titulo, descricao, status, prioridade, origem
  ) VALUES (
    p_condominio_id,
    auth.uid(),
    v_unidade,
    trim(p_titulo),
    NULLIF(trim(COALESCE(p_descricao, '')), ''),
    'aberto',
    'normal',
    v_origem
  )
  RETURNING * INTO v_row;

  INSERT INTO public.chamado_status_historico (
    chamado_id, status_anterior, status_novo, alterado_por, observacao
  ) VALUES (
    v_row.id, NULL, 'aberto', auth.uid(),
    CASE WHEN v_origem = 'administracao' THEN 'Chamado aberto pela Administração do condomínio'
         ELSE 'Chamado aberto' END
  );

  INSERT INTO public.conversas (condominio_id, tipo, titulo, chamado_id)
  VALUES (p_condominio_id, 'chamado', v_row.titulo, v_row.id);

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.minha_unidade(p_condominio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cargo public.tipo_cargo;
  v_unidade uuid;
BEGIN
  v_cargo := public.user_cargo_tipo(p_condominio_id);

  IF v_cargo = 'administracao'::public.tipo_cargo THEN
    v_unidade := public.garantir_unidade_areas_comuns(p_condominio_id);
    RETURN (
      SELECT to_jsonb(x)
      FROM (
        SELECT
          u.id,
          u.identificacao,
          u.bloco,
          u.identificacao AS rotulo
        FROM public.unidades u
        WHERE u.id = v_unidade
      ) x
    );
  END IF;

  RETURN (
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
    ) x
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.after_conversa_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin boolean := false;
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
        'administrador'::public.tipo_cargo
      )
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;

    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT NEW.id, u.id
    FROM public.usuarios u
    WHERE u.gestao_tecnica IS TRUE
      AND u.ativo IS TRUE
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;

    v_admin := public.chamado_eh_da_administracao(NEW.chamado_id);
    IF v_admin THEN
      INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
      SELECT NEW.id, uc.usuario_id
      FROM public.usuario_condominio uc
      JOIN public.cargos cg ON cg.id = uc.cargo_id
      WHERE uc.condominio_id = NEW.condominio_id
        AND uc.ativo IS TRUE
        AND cg.tipo = 'administracao'::public.tipo_cargo
      ON CONFLICT (conversa_id, usuario_id) DO NOTHING;
    END IF;
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

DROP TRIGGER IF EXISTS trg_conversa_participantes ON public.conversas;
CREATE TRIGGER trg_conversa_participantes
AFTER INSERT ON public.conversas
FOR EACH ROW
EXECUTE PROCEDURE public.after_conversa_insert();

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
        OR public.user_is_gestao(c.condominio_id)
        OR (
          public.user_is_administracao(c.condominio_id)
          AND public.chamado_eh_da_administracao(c.id)
        )
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

  IF public.chamado_eh_da_administracao(p_chamado_id) THEN
    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT v_conv, uc.usuario_id
    FROM public.usuario_condominio uc
    JOIN public.cargos cg ON cg.id = uc.cargo_id
    WHERE uc.condominio_id = v_ch.condominio_id
      AND uc.ativo IS TRUE
      AND cg.tipo = 'administracao'::public.tipo_cargo
    ON CONFLICT (conversa_id, usuario_id) DO UPDATE
      SET saiu_em = NULL;
  END IF;

  RETURN v_conv;
END;
$$;

-- Administração sai dos chats de morador e entra nos da administração.
DELETE FROM public.conversa_participantes cp
USING public.conversas cv
JOIN public.chamados c ON c.id = cv.chamado_id
WHERE cp.conversa_id = cv.id
  AND COALESCE(cv.tipo, 'chamado') <> 'laudo'
  AND NOT public.chamado_eh_da_administracao(c.id)
  AND cp.usuario_id <> c.solicitante_id
  AND EXISTS (
    SELECT 1
    FROM public.usuario_condominio uc
    JOIN public.cargos cg ON cg.id = uc.cargo_id
    WHERE uc.usuario_id = cp.usuario_id
      AND uc.condominio_id = c.condominio_id
      AND uc.ativo IS TRUE
      AND cg.tipo = 'administracao'::public.tipo_cargo
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = cp.usuario_id AND u.gestao_tecnica IS TRUE
  );

INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
SELECT cv.id, uc.usuario_id
FROM public.conversas cv
JOIN public.chamados c ON c.id = cv.chamado_id
JOIN public.usuario_condominio uc ON uc.condominio_id = c.condominio_id AND uc.ativo IS TRUE
JOIN public.cargos cg ON cg.id = uc.cargo_id AND cg.tipo = 'administracao'::public.tipo_cargo
WHERE COALESCE(cv.tipo, 'chamado') <> 'laudo'
  AND public.chamado_eh_da_administracao(c.id)
ON CONFLICT (conversa_id, usuario_id) DO UPDATE
  SET saiu_em = NULL;

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
    OR public.user_is_gestao(condominio_id)
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
      AND public.user_is_administracao(COALESCE(
        condominio_id,
        (SELECT c.condominio_id FROM public.chamados c WHERE c.id = chamado_id)
      ))
      AND public.chamado_eh_da_administracao(chamado_id)
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
            public.user_is_administracao(c.condominio_id)
            AND public.chamado_eh_da_administracao(c.id)
          )
          OR EXISTS (
            SELECT 1 FROM public.conversas cv
            WHERE cv.chamado_id = c.id AND public.user_participates(cv.id)
          )
        )
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
    OR EXISTS (
      SELECT 1 FROM public.conversas cv
      WHERE cv.id = mensagens.conversa_id
        AND COALESCE(cv.tipo, 'chamado') <> 'laudo'
        AND public.chamado_eh_da_administracao(cv.chamado_id)
        AND public.user_is_administracao(cv.condominio_id)
    )
  );

DROP POLICY IF EXISTS csh_select ON public.chamado_status_historico;
CREATE POLICY csh_select ON public.chamado_status_historico
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chamados c
      WHERE c.id = chamado_id
        AND (
          public.user_is_gestao_tecnica()
          OR public.user_is_gestao(c.condominio_id)
          OR c.solicitante_id = auth.uid()
          OR (
            public.user_is_administracao(c.condominio_id)
            AND public.chamado_eh_da_administracao(c.id)
          )
        )
    )
  );

GRANT EXECUTE ON FUNCTION public.user_is_administracao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chamado_eh_da_administracao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.garantir_unidade_areas_comuns(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_chamado(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minha_unidade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_falar_no_chamado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.garantir_chat_chamado(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
