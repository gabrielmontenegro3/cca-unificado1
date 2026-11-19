-- Recebimento dividido em dois:
--   * ÁREAS PRIVATIVAS (apartamentos): Gestão Técnica, construtora e o morador da unidade.
--       Síndico / administração do condomínio NÃO veem.
--   * ÁREAS COMUNS (piscina, salão, hall…): Gestão Técnica e construtora conversam;
--       síndico / administração só visualizam; morador NÃO vê.
-- Pré-requisitos: supabase/recebimento-vistoria.sql e supabase/recebimento-chat.sql já rodados.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

-- 1) Áreas comuns cadastradas pela Gestão Técnica.
CREATE TABLE IF NOT EXISTS public.recebimento_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ordem integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recebimento_areas_condo_idx
  ON public.recebimento_areas (condominio_id, ordem);

-- 2) Registros e mensagens passam a ser de uma unidade OU de uma área comum.
ALTER TABLE public.recebimento_registros
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES public.recebimento_areas(id) ON DELETE CASCADE;
ALTER TABLE public.recebimento_registros
  ALTER COLUMN unidade_id DROP NOT NULL;
ALTER TABLE public.recebimento_registros
  DROP CONSTRAINT IF EXISTS recebimento_registros_unidade_ou_area;
ALTER TABLE public.recebimento_registros
  ADD CONSTRAINT recebimento_registros_unidade_ou_area
  CHECK (num_nonnulls(unidade_id, area_id) = 1);
CREATE INDEX IF NOT EXISTS recebimento_registros_area_idx
  ON public.recebimento_registros (area_id, data_evento);

ALTER TABLE public.recebimento_mensagens
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES public.recebimento_areas(id) ON DELETE CASCADE;
ALTER TABLE public.recebimento_mensagens
  DROP CONSTRAINT IF EXISTS recebimento_mensagens_unidade_ou_registro;
ALTER TABLE public.recebimento_mensagens
  ADD CONSTRAINT recebimento_mensagens_unidade_ou_registro
  CHECK (unidade_id IS NOT NULL OR registro_id IS NOT NULL OR area_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS recebimento_mensagens_area_idx
  ON public.recebimento_mensagens (area_id, created_at);

-- 3) Quem vê o quê.
-- Áreas privativas: GT, construtora e o morador da unidade (o síndico NÃO).
CREATE OR REPLACE FUNCTION public.pode_ver_recebimento(cid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
    OR public.recebimento_e_construtora(cid)
    OR public.recebimento_e_morador_da_unidade(uid);
$$;

-- Áreas comuns: GT, construtora e a equipe do condomínio (síndico / administração).
CREATE OR REPLACE FUNCTION public.pode_ver_recebimento_area(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
    OR public.recebimento_e_construtora(cid)
    OR public.user_is_staff(cid);
$$;

-- Atalho usado nas regras: decide pela unidade ou pela área.
CREATE OR REPLACE FUNCTION public.pode_ver_recebimento_alvo(cid uuid, uid uuid, aid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN aid IS NOT NULL THEN public.pode_ver_recebimento_area(cid)
    ELSE public.pode_ver_recebimento(cid, uid)
  END;
$$;

REVOKE ALL ON FUNCTION public.pode_ver_recebimento_area(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pode_ver_recebimento_alvo(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_ver_recebimento(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_ver_recebimento_area(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_ver_recebimento_alvo(uuid, uuid, uuid) TO authenticated;

-- 4) Preenchimento automático (agora aceita unidade OU área).
CREATE OR REPLACE FUNCTION public.recebimento_registro_antes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.criado_por := auth.uid();
    NEW.autor_papel := public.recebimento_papel(NEW.condominio_id);
    NEW.resolvido := false;
    NEW.resolvido_em := NULL;
    NEW.resolvido_por := NULL;
    IF NEW.area_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.recebimento_areas a WHERE a.id = NEW.area_id AND a.condominio_id = NEW.condominio_id) THEN
        RAISE EXCEPTION 'Área comum não pertence a este condomínio';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.unidades u WHERE u.id = NEW.unidade_id AND u.condominio_id = NEW.condominio_id) THEN
      RAISE EXCEPTION 'Unidade não pertence a este condomínio';
    END IF;
    IF NEW.tipo = 'assinatura_entrega' AND EXISTS (
      SELECT 1 FROM public.recebimento_registros r
      WHERE r.tipo = 'problema' AND r.resolvido IS NOT TRUE
        AND ((NEW.area_id IS NOT NULL AND r.area_id = NEW.area_id)
          OR (NEW.area_id IS NULL AND r.unidade_id = NEW.unidade_id))
    ) THEN
      RAISE EXCEPTION 'Resolva todos os problemas antes de registrar a assinatura de entrega';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.condominio_id := OLD.condominio_id;
    NEW.unidade_id := OLD.unidade_id;
    NEW.area_id := OLD.area_id;
    NEW.tipo := OLD.tipo;
    NEW.titulo := OLD.titulo;
    NEW.descricao := OLD.descricao;
    NEW.data_evento := OLD.data_evento;
    NEW.criado_por := OLD.criado_por;
    NEW.autor_papel := OLD.autor_papel;
    NEW.created_at := OLD.created_at;
    IF NEW.resolvido IS DISTINCT FROM OLD.resolvido THEN
      NEW.resolvido_em := CASE WHEN NEW.resolvido THEN now() ELSE NULL END;
      NEW.resolvido_por := CASE WHEN NEW.resolvido THEN auth.uid() ELSE NULL END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.recebimento_mensagem_antes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo text;
  v_condo uuid;
  v_unidade uuid;
BEGIN
  IF NEW.registro_id IS NOT NULL THEN
    SELECT r.tipo, r.condominio_id, r.unidade_id INTO v_tipo, v_condo, v_unidade
    FROM public.recebimento_registros r WHERE r.id = NEW.registro_id;
    IF v_tipo IS DISTINCT FROM 'problema' THEN
      RAISE EXCEPTION 'O chat existe só nos problemas registrados';
    END IF;
    NEW.unidade_id := v_unidade;
  ELSIF NEW.area_id IS NOT NULL THEN
    SELECT a.condominio_id INTO v_condo FROM public.recebimento_areas a WHERE a.id = NEW.area_id;
    IF v_condo IS NULL THEN
      RAISE EXCEPTION 'Área comum não encontrada';
    END IF;
    NEW.unidade_id := NULL;
  ELSE
    IF NEW.unidade_id IS NULL THEN
      RAISE EXCEPTION 'Informe a unidade do chat';
    END IF;
    SELECT u.condominio_id INTO v_condo FROM public.unidades u WHERE u.id = NEW.unidade_id;
    IF v_condo IS NULL THEN
      RAISE EXCEPTION 'Unidade não encontrada';
    END IF;
  END IF;
  NEW.condominio_id := v_condo;
  NEW.usuario_id := auth.uid();
  NEW.autor_papel := public.recebimento_papel(NEW.condominio_id);
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

-- 5) Regras de acesso.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recebimento_areas TO authenticated;
ALTER TABLE public.recebimento_areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rarea_select ON public.recebimento_areas;
DROP POLICY IF EXISTS rarea_write ON public.recebimento_areas;
CREATE POLICY rarea_select ON public.recebimento_areas
  FOR SELECT TO authenticated
  USING (public.pode_ver_recebimento_area(condominio_id));
-- Só a Gestão Técnica cadastra, edita, ordena e exclui as áreas comuns.
CREATE POLICY rarea_write ON public.recebimento_areas
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica())
  WITH CHECK (public.user_is_gestao_tecnica());

DROP POLICY IF EXISTS rreg_select ON public.recebimento_registros;
CREATE POLICY rreg_select ON public.recebimento_registros
  FOR SELECT TO authenticated
  USING (public.pode_ver_recebimento_alvo(condominio_id, unidade_id, area_id));

DROP POLICY IF EXISTS rmsg_select ON public.recebimento_mensagens;
CREATE POLICY rmsg_select ON public.recebimento_mensagens
  FOR SELECT TO authenticated
  USING (public.pode_ver_recebimento_alvo(condominio_id, unidade_id, area_id));
-- Conversa: só Gestão Técnica e construtora escrevem (síndico e morador só leem).
DROP POLICY IF EXISTS rmsg_insert ON public.recebimento_mensagens;
CREATE POLICY rmsg_insert ON public.recebimento_mensagens
  FOR INSERT TO authenticated
  WITH CHECK (public.user_is_gestao_tecnica() OR public.recebimento_e_construtora(condominio_id));

DROP POLICY IF EXISTS rarq_select ON public.recebimento_arquivos;
CREATE POLICY rarq_select ON public.recebimento_arquivos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recebimento_registros r
      WHERE r.id = recebimento_arquivos.registro_id
        AND public.pode_ver_recebimento_alvo(r.condominio_id, r.unidade_id, r.area_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.recebimento_mensagens m
      WHERE m.id = recebimento_arquivos.mensagem_id
        AND public.pode_ver_recebimento_alvo(m.condominio_id, m.unidade_id, m.area_id)
    )
  );

NOTIFY pgrst, 'reload schema';
