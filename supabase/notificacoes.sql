-- Notificações + leitura de conversas
-- Rode no SQL Editor do Supabase (arquivo inteiro).

ALTER TABLE public.conversa_participantes
  ADD COLUMN IF NOT EXISTS ultima_leitura_em timestamptz;

CREATE TABLE IF NOT EXISTS public.notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  condominio_id uuid REFERENCES public.condominios(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  titulo text NOT NULL,
  corpo text,
  ref_tipo text,
  ref_id uuid,
  lida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notificacoes_usuario_idx
  ON public.notificacoes (usuario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notificacoes_nao_lidas_idx
  ON public.notificacoes (usuario_id)
  WHERE lida_em IS NULL;

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notificacoes_select ON public.notificacoes;
CREATE POLICY notificacoes_select ON public.notificacoes
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid() OR public.user_is_gestao_tecnica());

DROP POLICY IF EXISTS notificacoes_update ON public.notificacoes;
CREATE POLICY notificacoes_update ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

-- Marca conversa como lida para o usuário atual
CREATE OR REPLACE FUNCTION public.marcar_conversa_lida(p_conversa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_conversa_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.conversa_participantes (conversa_id, usuario_id, ultima_leitura_em)
  VALUES (p_conversa_id, auth.uid(), now())
  ON CONFLICT (conversa_id, usuario_id) DO UPDATE
    SET ultima_leitura_em = now(),
        saiu_em = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.marcar_conversa_lida_por_chamado(p_chamado_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.conversas WHERE chamado_id = p_chamado_id LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM public.marcar_conversa_lida(v_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.marcar_conversa_lida_por_laudo(p_laudo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.conversas WHERE laudo_id = p_laudo_id LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM public.marcar_conversa_lida(v_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.marcar_notificacao_lida(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notificacoes
  SET lida_em = now()
  WHERE id = p_id AND usuario_id = auth.uid() AND lida_em IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.marcar_todas_notificacoes_lidas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notificacoes
  SET lida_em = now()
  WHERE usuario_id = auth.uid() AND lida_em IS NULL;
END;
$$;

-- Estado das conversas do usuário: nova | nao_lida | lida
CREATE OR REPLACE FUNCTION public.resumo_leitura_conversas()
RETURNS TABLE (
  conversa_id uuid,
  condominio_id uuid,
  chamado_id uuid,
  laudo_id uuid,
  estado text,
  nao_lidas integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      c.id AS conversa_id,
      c.condominio_id,
      c.chamado_id,
      c.laudo_id,
      cp.ultima_leitura_em,
      (
        SELECT count(*)::int
        FROM public.mensagens m
        WHERE m.conversa_id = c.id
          AND m.excluido_em IS NULL
          AND m.usuario_id IS DISTINCT FROM auth.uid()
          AND (
            cp.ultima_leitura_em IS NULL
            OR m.created_at > cp.ultima_leitura_em
          )
      ) AS nao_lidas,
      EXISTS (
        SELECT 1
        FROM public.mensagens m
        WHERE m.conversa_id = c.id
          AND m.excluido_em IS NULL
      ) AS tem_msg
    FROM public.conversas c
    LEFT JOIN public.conversa_participantes cp
      ON cp.conversa_id = c.id AND cp.usuario_id = auth.uid()
    WHERE public.user_is_gestao_tecnica()
       OR public.user_belongs_to_condominio(c.condominio_id)
  )
  SELECT
    b.conversa_id,
    b.condominio_id,
    b.chamado_id,
    b.laudo_id,
    CASE
      WHEN b.tem_msg AND b.ultima_leitura_em IS NULL THEN 'nova'
      WHEN COALESCE(b.nao_lidas, 0) > 0 THEN 'nao_lida'
      ELSE 'lida'
    END AS estado,
    COALESCE(b.nao_lidas, 0) AS nao_lidas
  FROM base b;
$$;

CREATE OR REPLACE FUNCTION public.condominios_com_conversas_nao_lidas()
RETURNS TABLE (condominio_id uuid, total integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.condominio_id, count(*)::int AS total
  FROM public.resumo_leitura_conversas() r
  WHERE r.estado IN ('nova', 'nao_lida')
    AND r.condominio_id IS NOT NULL
  GROUP BY r.condominio_id;
$$;

CREATE OR REPLACE FUNCTION public.criar_notificacao(
  p_usuario_id uuid,
  p_condominio_id uuid,
  p_tipo text,
  p_titulo text,
  p_corpo text,
  p_ref_tipo text,
  p_ref_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_usuario_id IS NULL OR p_usuario_id = auth.uid() THEN
    RETURN;
  END IF;
  INSERT INTO public.notificacoes (
    usuario_id, condominio_id, tipo, titulo, corpo, ref_tipo, ref_id
  ) VALUES (
    p_usuario_id, p_condominio_id, p_tipo, p_titulo, p_corpo, p_ref_tipo, p_ref_id
  );
END;
$$;

-- Nova mensagem → notifica participantes (exceto autor)
CREATE OR REPLACE FUNCTION public.trg_notificar_nova_mensagem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_condo uuid;
  v_titulo text;
  v_part uuid;
  v_preview text;
BEGIN
  SELECT c.condominio_id, COALESCE(c.titulo, 'Conversa')
  INTO v_condo, v_titulo
  FROM public.conversas c
  WHERE c.id = NEW.conversa_id;

  v_preview := left(COALESCE(NEW.texto, 'Nova mensagem'), 140);

  FOR v_part IN
    SELECT cp.usuario_id
    FROM public.conversa_participantes cp
    WHERE cp.conversa_id = NEW.conversa_id
      AND cp.usuario_id IS DISTINCT FROM NEW.usuario_id
      AND (cp.saiu_em IS NULL)
  LOOP
    PERFORM public.criar_notificacao(
      v_part,
      v_condo,
      'mensagem',
      'Nova mensagem: ' || v_titulo,
      v_preview,
      'conversa',
      NEW.conversa_id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_mensagem_notificar ON public.mensagens;
CREATE TRIGGER after_mensagem_notificar
  AFTER INSERT ON public.mensagens
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notificar_nova_mensagem();

-- Boletim publicado → notifica usuários do condomínio (exceto autor)
CREATE OR REPLACE FUNCTION public.trg_notificar_boletim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF NEW.publicado IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.publicado IS TRUE THEN
    RETURN NEW;
  END IF;

  FOR v_uid IN
    SELECT uc.usuario_id
    FROM public.usuario_condominio uc
    WHERE uc.condominio_id = NEW.condominio_id
      AND uc.ativo IS TRUE
      AND uc.usuario_id IS DISTINCT FROM NEW.autor_id
    UNION
    SELECT u.id
    FROM public.usuarios u
    WHERE u.gestao_tecnica IS TRUE
      AND u.ativo IS TRUE
      AND u.id IS DISTINCT FROM NEW.autor_id
  LOOP
    PERFORM public.criar_notificacao(
      v_uid,
      NEW.condominio_id,
      'boletim',
      'Novo boletim: ' || COALESCE(NEW.titulo, 'Informativo'),
      left(COALESCE(NEW.subtitulo, NEW.texto, ''), 160),
      'boletim',
      NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_boletim_notificar ON public.boletins_informativos;
CREATE TRIGGER after_boletim_notificar
  AFTER INSERT OR UPDATE OF publicado ON public.boletins_informativos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notificar_boletim();

-- Mudança de status do chamado → notifica solicitante
CREATE OR REPLACE FUNCTION public.trg_notificar_status_chamado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.solicitante_id IS NOT NULL AND NEW.solicitante_id IS DISTINCT FROM auth.uid() THEN
    PERFORM public.criar_notificacao(
      NEW.solicitante_id,
      NEW.condominio_id,
      'status_chamado',
      'Status do chamado atualizado',
      COALESCE(NEW.titulo, 'Chamado') || ': ' || COALESCE(NEW.status::text, ''),
      'chamado',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_chamado_status_notificar ON public.chamados;
CREATE TRIGGER after_chamado_status_notificar
  AFTER UPDATE OF status ON public.chamados
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notificar_status_chamado();

GRANT EXECUTE ON FUNCTION public.marcar_conversa_lida(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_conversa_lida_por_chamado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_conversa_lida_por_laudo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_notificacao_lida(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_todas_notificacoes_lidas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.resumo_leitura_conversas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.condominios_com_conversas_nao_lidas() TO authenticated;

NOTIFY pgrst, 'reload schema';
