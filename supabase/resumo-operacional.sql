-- Resumo de chamados/manutenções/laudos para Construtora e staff.
-- A Construtora não lê a tabela de chamados (não abre ocorrência).
-- Rode no SQL Editor do Supabase (arquivo inteiro).

CREATE OR REPLACE FUNCTION public.user_is_construtora(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_cargo_tipo(cid) = 'construtora'::public.tipo_cargo;
$$;

CREATE OR REPLACE FUNCTION public.resumo_operacional_condominio(p_condominio_id uuid)
RETURNS TABLE (
  aberto integer,
  andamento integer,
  concluido integer,
  total integer,
  manutencoes integer,
  laudos integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_condominio_id IS NULL THEN
    RAISE EXCEPTION 'Condomínio inválido';
  END IF;
  IF NOT (
    public.user_is_gestao_tecnica()
    OR public.user_is_staff(p_condominio_id)
    OR public.user_is_construtora(p_condominio_id)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE c.status = 'aberto')::int,
    COUNT(*) FILTER (WHERE c.status IN (
      'em_analise', 'aguardando_morador', 'aguardando_fornecedor', 'em_execucao'
    ))::int,
    COUNT(*) FILTER (WHERE c.status IN ('resolvido', 'encerrado'))::int,
    COUNT(*)::int,
    (
      SELECT COUNT(*)::int
      FROM public.manutencoes_preventivas m
      WHERE m.condominio_id = p_condominio_id
        AND COALESCE(m.ativo, TRUE)
    ),
    (
      SELECT COUNT(*)::int
      FROM public.laudos_tecnicos l
      WHERE l.condominio_id = p_condominio_id
    )
  FROM public.chamados c
  WHERE c.condominio_id = p_condominio_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_is_construtora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resumo_operacional_condominio(uuid) TO authenticated;

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

GRANT EXECUTE ON FUNCTION public.pode_ver_laudo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_falar_no_laudo(uuid) TO authenticated;

DROP POLICY IF EXISTS lau_select ON public.laudos_tecnicos;
CREATE POLICY lau_select ON public.laudos_tecnicos
  FOR SELECT TO authenticated
  USING (public.pode_ver_laudo(condominio_id));

DROP POLICY IF EXISTS la_select ON public.laudo_arquivos;
CREATE POLICY la_select ON public.laudo_arquivos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.laudos_tecnicos l
      WHERE l.id = laudo_id AND public.pode_ver_laudo(l.condominio_id)
    )
  );

ALTER TABLE public.laudos_tecnicos
  ADD COLUMN IF NOT EXISTS criticidade text;

DROP FUNCTION IF EXISTS public.listar_laudos_governanca(uuid);
DROP FUNCTION IF EXISTS public.laudo_governanca(uuid);

CREATE OR REPLACE FUNCTION public.listar_laudos_governanca(p_condominio_id uuid)
RETURNS TABLE (
  id uuid,
  condominio_id uuid,
  chamado_id uuid,
  criado_por uuid,
  titulo text,
  descricao text,
  criticidade text,
  numero_registro bigint,
  created_at timestamptz,
  chamado_numero bigint,
  chamado_titulo text,
  criador_nome text,
  unidade_identificacao text,
  unidade_bloco text,
  unidade_andar text,
  capa_storage_path text,
  capa_mime text,
  capa_nome text,
  capa_tipo text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_condominio_id IS NULL OR NOT public.pode_ver_laudo(p_condominio_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.condominio_id,
    l.chamado_id,
    l.criado_por,
    l.titulo::text,
    l.descricao::text,
    l.criticidade::text,
    l.numero_registro::bigint,
    l.created_at::timestamptz,
    c.numero_registro::bigint,
    c.titulo::text,
    u.nome::text,
    un.identificacao::text,
    un.bloco::text,
    un.andar::text,
    capa.storage_path::text,
    capa.mime_type::text,
    capa.nome_original::text,
    capa.tipo::text
  FROM public.laudos_tecnicos l
  LEFT JOIN public.chamados c ON c.id = l.chamado_id
  LEFT JOIN public.unidades un ON un.id = c.unidade_id
  LEFT JOIN public.usuarios u ON u.id = l.criado_por
  LEFT JOIN LATERAL (
    SELECT a.storage_path, a.mime_type, a.nome_original, a.tipo
    FROM public.laudo_arquivos la
    JOIN public.arquivos a ON a.id = la.arquivo_id
    WHERE la.laudo_id = l.id
    ORDER BY a.created_at ASC NULLS LAST
    LIMIT 1
  ) capa ON TRUE
  WHERE l.condominio_id = p_condominio_id
  ORDER BY l.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.laudo_governanca(p_laudo_id uuid)
RETURNS TABLE (
  id uuid,
  condominio_id uuid,
  chamado_id uuid,
  criado_por uuid,
  titulo text,
  descricao text,
  criticidade text,
  numero_registro bigint,
  created_at timestamptz,
  chamado_numero bigint,
  chamado_titulo text,
  criador_nome text,
  unidade_identificacao text,
  unidade_bloco text,
  unidade_andar text,
  capa_storage_path text,
  capa_mime text,
  capa_nome text,
  capa_tipo text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_condo uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT l.condominio_id INTO v_condo
  FROM public.laudos_tecnicos l
  WHERE l.id = p_laudo_id;

  IF v_condo IS NULL THEN
    RAISE EXCEPTION 'Laudo não encontrado';
  END IF;
  IF NOT public.pode_ver_laudo(v_condo) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.condominio_id,
    l.chamado_id,
    l.criado_por,
    l.titulo::text,
    l.descricao::text,
    l.criticidade::text,
    l.numero_registro::bigint,
    l.created_at::timestamptz,
    c.numero_registro::bigint,
    c.titulo::text,
    u.nome::text,
    un.identificacao::text,
    un.bloco::text,
    un.andar::text,
    capa.storage_path::text,
    capa.mime_type::text,
    capa.nome_original::text,
    capa.tipo::text
  FROM public.laudos_tecnicos l
  LEFT JOIN public.chamados c ON c.id = l.chamado_id
  LEFT JOIN public.unidades un ON un.id = c.unidade_id
  LEFT JOIN public.usuarios u ON u.id = l.criado_por
  LEFT JOIN LATERAL (
    SELECT a.storage_path, a.mime_type, a.nome_original, a.tipo
    FROM public.laudo_arquivos la
    JOIN public.arquivos a ON a.id = la.arquivo_id
    WHERE la.laudo_id = l.id
    ORDER BY a.created_at ASC NULLS LAST
    LIMIT 1
  ) capa ON TRUE
  WHERE l.id = p_laudo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_laudos_governanca(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.laudo_governanca(uuid) TO authenticated;

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
        'administrador'::public.tipo_cargo
      )
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;

    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT NEW.id, u.id
    FROM public.usuarios u
    WHERE u.gestao_tecnica IS TRUE
      AND u.ativo IS TRUE
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;

    IF NEW.chamado_id IS NOT NULL AND public.chamado_eh_da_administracao(NEW.chamado_id) THEN
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

NOTIFY pgrst, 'reload schema';

