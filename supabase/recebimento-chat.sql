-- Recebimento em formato de chat (igual à tela de Chamados):
--   * um chat por unidade, entre Gestão Técnica e construtora (com anexos);
--   * o morador só lê;
--   * "Agendar vistoria" (só Gestão Técnica): título + data, aparece no chat;
--   * "OK" da entrega (só Gestão Técnica): a unidade fica verde com o selo.
-- Pré-requisito: supabase/recebimento-vistoria.sql já rodado.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

-- 1) Mensagens passam a ser da unidade (não precisam mais de um "problema").
ALTER TABLE public.recebimento_mensagens
  ADD COLUMN IF NOT EXISTS unidade_id uuid REFERENCES public.unidades(id) ON DELETE CASCADE;
ALTER TABLE public.recebimento_mensagens
  ALTER COLUMN registro_id DROP NOT NULL;

-- Mensagens antigas (dos problemas) entram no chat da unidade do problema.
UPDATE public.recebimento_mensagens m
SET unidade_id = r.unidade_id
FROM public.recebimento_registros r
WHERE r.id = m.registro_id AND m.unidade_id IS NULL;

ALTER TABLE public.recebimento_mensagens
  DROP CONSTRAINT IF EXISTS recebimento_mensagens_unidade_ou_registro;
ALTER TABLE public.recebimento_mensagens
  ADD CONSTRAINT recebimento_mensagens_unidade_ou_registro
  CHECK (unidade_id IS NOT NULL OR registro_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS recebimento_mensagens_unidade_idx
  ON public.recebimento_mensagens (unidade_id, created_at);

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

-- 2) Quem lê e quem escreve no chat.
DROP POLICY IF EXISTS rmsg_select ON public.recebimento_mensagens;
DROP POLICY IF EXISTS rmsg_insert ON public.recebimento_mensagens;
CREATE POLICY rmsg_select ON public.recebimento_mensagens
  FOR SELECT TO authenticated
  USING (public.pode_ver_recebimento(condominio_id, unidade_id));
-- Só Gestão Técnica e construtora mandam mensagem; o morador só lê.
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
        AND public.pode_ver_recebimento(r.condominio_id, r.unidade_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.recebimento_mensagens m
      WHERE m.id = recebimento_arquivos.mensagem_id
        AND public.pode_ver_recebimento(m.condominio_id, m.unidade_id)
    )
  );

-- 3) A Gestão Técnica pode desfazer o OK ou apagar um agendamento errado.
GRANT DELETE ON TABLE public.recebimento_registros TO authenticated;
DROP POLICY IF EXISTS rreg_delete ON public.recebimento_registros;
CREATE POLICY rreg_delete ON public.recebimento_registros
  FOR DELETE TO authenticated
  USING (public.user_is_gestao_tecnica() AND tipo IN ('vistoria_agendada', 'assinatura_entrega'));

NOTIFY pgrst, 'reload schema';
