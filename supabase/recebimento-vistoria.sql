-- Recebimento: vistoria de entrega de cada unidade, em linha do tempo.
--   * Gestão Técnica: agenda a vistoria, registra problemas (cada problema abre um chat
--     com a construtora), registra a vistoria realizada e a assinatura de entrega.
--   * Construtora: cria registros (título, descrição, anexos) e conversa nos problemas.
--   * Morador: lê a linha do tempo do próprio imóvel e pode solicitar vistoria.
-- Pré-requisitos: acesso-construtora.sql e chat-laudo.sql já rodados.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

-- 1) Papéis
CREATE OR REPLACE FUNCTION public.recebimento_e_construtora(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_construtora(cid) OR public.user_is_construtora_org_do_condominio(cid);
$$;

CREATE OR REPLACE FUNCTION public.recebimento_e_morador_da_unidade(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.unidade_moradores um
    WHERE um.unidade_id = uid AND um.usuario_id = auth.uid()
  );
$$;

-- Quem lê a linha do tempo da unidade: GT, construtora, equipe do condomínio e o morador dela.
CREATE OR REPLACE FUNCTION public.pode_ver_recebimento(cid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
    OR public.recebimento_e_construtora(cid)
    OR public.user_is_staff(cid)
    OR public.recebimento_e_morador_da_unidade(uid);
$$;

-- Papel de quem está escrevendo, guardado em cada registro/mensagem.
CREATE OR REPLACE FUNCTION public.recebimento_papel(cid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.user_is_gestao_tecnica() THEN 'gestao_tecnica'
    WHEN public.recebimento_e_construtora(cid) THEN 'construtora'
    ELSE COALESCE(public.user_cargo_tipo(cid)::text, 'morador')
  END;
$$;

REVOKE ALL ON FUNCTION public.recebimento_e_construtora(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recebimento_e_morador_da_unidade(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pode_ver_recebimento(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recebimento_papel(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recebimento_e_construtora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recebimento_e_morador_da_unidade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_ver_recebimento(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recebimento_papel(uuid) TO authenticated;

-- 2) Registros da linha do tempo
CREATE TABLE IF NOT EXISTS public.recebimento_registros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  unidade_id uuid NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN (
    'vistoria_agendada',   -- GT marca a data da vistoria de entrega
    'problema',            -- GT registra um problema (abre chat com a construtora)
    'vistoria_solicitada', -- morador pede uma vistoria
    'vistoria_realizada',  -- GT registra que a vistoria presencial foi feita
    'construtora',         -- construtora registra algo (título livre)
    'assinatura_entrega'   -- GT registra a assinatura de entrega
  )),
  titulo text,
  descricao text,
  data_evento timestamptz NOT NULL DEFAULT now(),
  resolvido boolean NOT NULL DEFAULT false,
  resolvido_em timestamptz,
  resolvido_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_por uuid DEFAULT auth.uid() REFERENCES public.usuarios(id) ON DELETE SET NULL,
  autor_papel text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recebimento_registros_unidade_idx
  ON public.recebimento_registros (unidade_id, data_evento);
CREATE INDEX IF NOT EXISTS recebimento_registros_condo_idx
  ON public.recebimento_registros (condominio_id, tipo);

-- 3) Mensagens do chat de cada problema
CREATE TABLE IF NOT EXISTS public.recebimento_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id uuid NOT NULL REFERENCES public.recebimento_registros(id) ON DELETE CASCADE,
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  usuario_id uuid DEFAULT auth.uid() REFERENCES public.usuarios(id) ON DELETE SET NULL,
  autor_papel text,
  texto text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recebimento_mensagens_registro_idx
  ON public.recebimento_mensagens (registro_id, created_at);

-- 4) Anexos (de um registro ou de uma mensagem)
CREATE TABLE IF NOT EXISTS public.recebimento_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  registro_id uuid REFERENCES public.recebimento_registros(id) ON DELETE CASCADE,
  mensagem_id uuid REFERENCES public.recebimento_mensagens(id) ON DELETE CASCADE,
  arquivo_id uuid NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (registro_id IS NOT NULL OR mensagem_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS recebimento_arquivos_registro_idx ON public.recebimento_arquivos (registro_id);
CREATE INDEX IF NOT EXISTS recebimento_arquivos_mensagem_idx ON public.recebimento_arquivos (mensagem_id);

-- 5) Preenchimento automático e regras que não dependem da tela
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
    -- A unidade precisa ser do mesmo condomínio.
    IF NOT EXISTS (SELECT 1 FROM public.unidades u WHERE u.id = NEW.unidade_id AND u.condominio_id = NEW.condominio_id) THEN
      RAISE EXCEPTION 'Unidade não pertence a este condomínio';
    END IF;
    -- Assinatura de entrega só sem problema em aberto.
    IF NEW.tipo = 'assinatura_entrega' AND EXISTS (
      SELECT 1 FROM public.recebimento_registros r
      WHERE r.unidade_id = NEW.unidade_id AND r.tipo = 'problema' AND r.resolvido IS NOT TRUE
    ) THEN
      RAISE EXCEPTION 'Resolva todos os problemas antes de registrar a assinatura de entrega';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Só muda o "resolvido"; o resto do registro é histórico.
    NEW.condominio_id := OLD.condominio_id;
    NEW.unidade_id := OLD.unidade_id;
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

DROP TRIGGER IF EXISTS recebimento_registro_antes ON public.recebimento_registros;
CREATE TRIGGER recebimento_registro_antes
  BEFORE INSERT OR UPDATE ON public.recebimento_registros
  FOR EACH ROW EXECUTE FUNCTION public.recebimento_registro_antes();

CREATE OR REPLACE FUNCTION public.recebimento_mensagem_antes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo text;
  v_condo uuid;
BEGIN
  SELECT r.tipo, r.condominio_id INTO v_tipo, v_condo
  FROM public.recebimento_registros r WHERE r.id = NEW.registro_id;
  IF v_tipo IS DISTINCT FROM 'problema' THEN
    RAISE EXCEPTION 'O chat existe só nos problemas registrados';
  END IF;
  NEW.condominio_id := v_condo;
  NEW.usuario_id := auth.uid();
  NEW.autor_papel := public.recebimento_papel(NEW.condominio_id);
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recebimento_mensagem_antes ON public.recebimento_mensagens;
CREATE TRIGGER recebimento_mensagem_antes
  BEFORE INSERT ON public.recebimento_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.recebimento_mensagem_antes();

-- 6) Permissões
GRANT SELECT, INSERT, UPDATE ON TABLE public.recebimento_registros TO authenticated;
GRANT SELECT, INSERT ON TABLE public.recebimento_mensagens TO authenticated;
GRANT SELECT, INSERT ON TABLE public.recebimento_arquivos TO authenticated;

ALTER TABLE public.recebimento_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recebimento_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recebimento_arquivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rreg_select ON public.recebimento_registros;
DROP POLICY IF EXISTS rreg_insert ON public.recebimento_registros;
DROP POLICY IF EXISTS rreg_update ON public.recebimento_registros;
CREATE POLICY rreg_select ON public.recebimento_registros
  FOR SELECT TO authenticated
  USING (public.pode_ver_recebimento(condominio_id, unidade_id));
-- Cada papel cria só os tipos que lhe cabem.
CREATE POLICY rreg_insert ON public.recebimento_registros
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.user_is_gestao_tecnica()
      AND tipo IN ('vistoria_agendada', 'problema', 'vistoria_realizada', 'assinatura_entrega'))
    OR (public.recebimento_e_construtora(condominio_id) AND tipo = 'construtora')
    OR (public.recebimento_e_morador_da_unidade(unidade_id) AND tipo = 'vistoria_solicitada')
  );
-- Só a Gestão Técnica marca problema como resolvido.
CREATE POLICY rreg_update ON public.recebimento_registros
  FOR UPDATE TO authenticated
  USING (public.user_is_gestao_tecnica() AND tipo = 'problema')
  WITH CHECK (public.user_is_gestao_tecnica() AND tipo = 'problema');

DROP POLICY IF EXISTS rmsg_select ON public.recebimento_mensagens;
DROP POLICY IF EXISTS rmsg_insert ON public.recebimento_mensagens;
CREATE POLICY rmsg_select ON public.recebimento_mensagens
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recebimento_registros r
    WHERE r.id = registro_id AND public.pode_ver_recebimento(r.condominio_id, r.unidade_id)
  ));
-- Chat do problema: só Gestão Técnica e construtora escrevem.
CREATE POLICY rmsg_insert ON public.recebimento_mensagens
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.recebimento_registros r
    WHERE r.id = registro_id
      AND (public.user_is_gestao_tecnica() OR public.recebimento_e_construtora(r.condominio_id))
  ));

DROP POLICY IF EXISTS rarq_select ON public.recebimento_arquivos;
DROP POLICY IF EXISTS rarq_insert ON public.recebimento_arquivos;
CREATE POLICY rarq_select ON public.recebimento_arquivos
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recebimento_registros r
    LEFT JOIN public.recebimento_mensagens m ON m.id = recebimento_arquivos.mensagem_id
    WHERE r.id = COALESCE(recebimento_arquivos.registro_id, m.registro_id)
      AND public.pode_ver_recebimento(r.condominio_id, r.unidade_id)
  ));
-- Anexa quem criou o registro ou a mensagem.
CREATE POLICY rarq_insert ON public.recebimento_arquivos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.recebimento_registros r WHERE r.id = registro_id AND r.criado_por = auth.uid())
    OR EXISTS (SELECT 1 FROM public.recebimento_mensagens m WHERE m.id = mensagem_id AND m.usuario_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
