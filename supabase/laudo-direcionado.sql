-- Status do chamado quando a Gestão Técnica direciona um laudo à construtora.
-- Rode o ARQUIVO INTEIRO no SQL Editor.
-- Se o bloco do resumo falhar com "unsafe use of new value", rode só esse bloco de novo.

ALTER TYPE public.status_chamado ADD VALUE IF NOT EXISTS 'laudo_direcionado';

CREATE OR REPLACE FUNCTION public.trg_notificar_status_chamado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_status := NEW.status::text;
  IF v_status = 'laudo_direcionado' THEN
    v_status := 'Laudo direcionado. Aguardando resposta da construtora.';
  END IF;

  IF NEW.solicitante_id IS NOT NULL AND NEW.solicitante_id IS DISTINCT FROM auth.uid() THEN
    PERFORM public.criar_notificacao(
      NEW.solicitante_id,
      NEW.condominio_id,
      'status_chamado',
      'Status do chamado atualizado',
      COALESCE(NEW.titulo, 'Chamado') || ': ' || COALESCE(v_status, ''),
      'chamado',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
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
    COUNT(*) FILTER (WHERE c.status::text IN (
      'em_analise', 'aguardando_morador', 'aguardando_fornecedor', 'em_execucao', 'laudo_direcionado'
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
