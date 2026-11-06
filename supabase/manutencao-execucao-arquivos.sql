-- Manutenção preventiva: arquivos anexados a cada execução + morador sem acesso.
-- Pré-requisito: supabase/manutencao-execucoes-relatorio.sql já rodado.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

-- 1) Quem pode VER a manutenção: todos do condomínio, menos o morador.
CREATE OR REPLACE FUNCTION public.pode_ver_manutencao(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_gestao_tecnica()
    OR (
      public.user_belongs_to_condominio(cid)
      AND COALESCE(public.user_cargo_tipo(cid)::text, '') <> 'morador'
    );
$$;

REVOKE ALL ON FUNCTION public.pode_ver_manutencao(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_ver_manutencao(uuid) TO authenticated;

-- 2) Arquivos de cada execução.
CREATE TABLE IF NOT EXISTS public.manutencao_registro_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id uuid NOT NULL REFERENCES public.manutencao_registros(id) ON DELETE CASCADE,
  arquivo_id uuid NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE,
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registro_id, arquivo_id)
);

CREATE INDEX IF NOT EXISTS manutencao_registro_arquivos_registro_idx
  ON public.manutencao_registro_arquivos (registro_id, ordem);
CREATE INDEX IF NOT EXISTS manutencao_registro_arquivos_condo_idx
  ON public.manutencao_registro_arquivos (condominio_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manutencao_registro_arquivos TO authenticated;
ALTER TABLE public.manutencao_registro_arquivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mrarq_select ON public.manutencao_registro_arquivos;
DROP POLICY IF EXISTS mrarq_write ON public.manutencao_registro_arquivos;
CREATE POLICY mrarq_select ON public.manutencao_registro_arquivos
  FOR SELECT TO authenticated
  USING (public.pode_ver_manutencao(condominio_id));
CREATE POLICY mrarq_write ON public.manutencao_registro_arquivos
  FOR ALL TO authenticated
  USING (public.pode_registrar_manutencao(condominio_id))
  WITH CHECK (public.pode_registrar_manutencao(condominio_id));

-- 3) Morador não lê documentos, subsistemas nem execuções da manutenção.
DROP POLICY IF EXISTS mdoc_select ON public.manutencao_documentos;
CREATE POLICY mdoc_select ON public.manutencao_documentos
  FOR SELECT TO authenticated
  USING (public.pode_ver_manutencao(condominio_id));

DROP POLICY IF EXISTS msub_select ON public.manutencao_subsistemas;
CREATE POLICY msub_select ON public.manutencao_subsistemas
  FOR SELECT TO authenticated
  USING (public.pode_ver_manutencao(condominio_id));

DROP POLICY IF EXISTS mreg_select ON public.manutencao_registros;
CREATE POLICY mreg_select ON public.manutencao_registros
  FOR SELECT TO authenticated
  USING (public.pode_ver_manutencao(condominio_id));

-- 4) Registrar execução agora recebe os arquivos anexados (opcional).
DROP FUNCTION IF EXISTS public.registrar_execucao_manutencao(uuid, text, date, text);
DROP FUNCTION IF EXISTS public.registrar_execucao_manutencao(uuid, text, date, text, uuid[]);

CREATE FUNCTION public.registrar_execucao_manutencao(
  p_condominio_id uuid,
  p_subsistema text,
  p_data date,
  p_observacao text,
  p_arquivos uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_nome text;
  v_id uuid;
  -- A data da execução é sempre o dia do envio (horário de Brasília).
  -- p_data fica na assinatura só por compatibilidade e é ignorado.
  v_data date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.pode_registrar_manutencao(p_condominio_id) THEN
    RAISE EXCEPTION 'Somente o síndico registra a execução';
  END IF;
  v_nome := NULLIF(trim(COALESCE(p_subsistema, '')), '');
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Informe o subsistema';
  END IF;

  INSERT INTO public.manutencao_subsistemas (condominio_id, nome)
  VALUES (p_condominio_id, v_nome)
  ON CONFLICT (condominio_id, nome) DO NOTHING;

  INSERT INTO public.manutencao_registros (
    condominio_id, subsistema, data_execucao, observacao, executado_por
  )
  VALUES (
    p_condominio_id,
    v_nome,
    v_data,
    NULLIF(trim(COALESCE(p_observacao, '')), ''),
    auth.uid()
  )
  RETURNING id INTO v_id;

  -- Só vincula arquivos do próprio condomínio.
  IF p_arquivos IS NOT NULL AND array_length(p_arquivos, 1) > 0 THEN
    INSERT INTO public.manutencao_registro_arquivos (registro_id, arquivo_id, condominio_id, ordem)
    SELECT v_id, a.id, p_condominio_id, (x.ord - 1)::int
    FROM unnest(p_arquivos) WITH ORDINALITY AS x(arquivo_id, ord)
    JOIN public.arquivos a ON a.id = x.arquivo_id AND a.condominio_id = p_condominio_id
    ON CONFLICT (registro_id, arquivo_id) DO NOTHING;
  END IF;

  UPDATE public.manutencoes_preventivas
  SET
    ultima_execucao = v_data,
    proxima_execucao = CASE periodicidade::text
      WHEN 'diaria' THEN v_data + 1
      WHEN 'semanal' THEN v_data + 7
      WHEN 'quinzenal' THEN v_data + 15
      WHEN 'mensal' THEN v_data + 30
      WHEN 'bimestral' THEN v_data + 60
      WHEN 'trimestral' THEN v_data + 90
      WHEN 'semestral' THEN v_data + 180
      WHEN 'anual' THEN v_data + 365
      ELSE v_data + 30
    END
  WHERE condominio_id = p_condominio_id
    AND lower(trim(sistema)) = lower(v_nome);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_execucao_manutencao(uuid, text, date, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_execucao_manutencao(uuid, text, date, text, uuid[]) TO authenticated;

-- 5) Mesmo num INSERT direto na tabela, a data é sempre o dia do envio.
CREATE OR REPLACE FUNCTION public.manutencao_registros_data_envio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.data_execucao := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manutencao_registros_data_envio ON public.manutencao_registros;
CREATE TRIGGER manutencao_registros_data_envio
  BEFORE INSERT ON public.manutencao_registros
  FOR EACH ROW EXECUTE FUNCTION public.manutencao_registros_data_envio();

NOTIFY pgrst, 'reload schema';
