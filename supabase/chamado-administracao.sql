-- Administração do condomínio pode abrir chamado das Áreas comuns.
-- Rode o ARQUIVO INTEIRO no SQL Editor.

ALTER TABLE public.chamados
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'morador';

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
    AND lower(trim(u.identificacao)) IN ('áreas comuns', 'areas comuns')
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
    AND lower(trim(u.identificacao)) IN ('áreas comuns', 'areas comuns')
);

DROP POLICY IF EXISTS ch_insert ON public.chamados;
CREATE POLICY ch_insert ON public.chamados
  FOR INSERT TO authenticated
  WITH CHECK (
    solicitante_id = auth.uid()
    AND public.user_cargo_tipo(condominio_id) IN (
      'morador'::public.tipo_cargo,
      'administracao'::public.tipo_cargo
    )
  );

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

GRANT EXECUTE ON FUNCTION public.garantir_unidade_areas_comuns(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_chamado(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minha_unidade(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
