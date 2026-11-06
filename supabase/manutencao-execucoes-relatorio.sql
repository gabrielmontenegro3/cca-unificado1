-- Documentos da tela de manutenção, subsistemas e registro de execução do síndico.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.manutencao_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  arquivo_id uuid NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manutencao_documentos_condo_idx
  ON public.manutencao_documentos (condominio_id, ordem);

CREATE TABLE IF NOT EXISTS public.manutencao_subsistemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (condominio_id, nome)
);

CREATE TABLE IF NOT EXISTS public.manutencao_registros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  subsistema text NOT NULL,
  data_execucao date NOT NULL DEFAULT CURRENT_DATE,
  observacao text,
  executado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manutencao_registros_condo_idx
  ON public.manutencao_registros (condominio_id, data_execucao DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manutencao_documentos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manutencao_subsistemas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manutencao_registros TO authenticated;

ALTER TABLE public.manutencao_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manutencao_subsistemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manutencao_registros ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.pode_registrar_manutencao(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(cid)
    OR public.user_cargo_tipo(cid) = 'administracao'::public.tipo_cargo;
$$;

DROP POLICY IF EXISTS mdoc_select ON public.manutencao_documentos;
DROP POLICY IF EXISTS mdoc_write ON public.manutencao_documentos;
CREATE POLICY mdoc_select ON public.manutencao_documentos
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY mdoc_write ON public.manutencao_documentos
  FOR ALL TO authenticated
  USING (public.pode_registrar_manutencao(condominio_id))
  WITH CHECK (public.pode_registrar_manutencao(condominio_id));

DROP POLICY IF EXISTS msub_select ON public.manutencao_subsistemas;
DROP POLICY IF EXISTS msub_write ON public.manutencao_subsistemas;
CREATE POLICY msub_select ON public.manutencao_subsistemas
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY msub_write ON public.manutencao_subsistemas
  FOR ALL TO authenticated
  USING (public.pode_registrar_manutencao(condominio_id))
  WITH CHECK (public.pode_registrar_manutencao(condominio_id));

DROP POLICY IF EXISTS mreg_select ON public.manutencao_registros;
DROP POLICY IF EXISTS mreg_write ON public.manutencao_registros;
CREATE POLICY mreg_select ON public.manutencao_registros
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY mreg_write ON public.manutencao_registros
  FOR INSERT TO authenticated
  WITH CHECK (public.pode_registrar_manutencao(condominio_id));

CREATE OR REPLACE FUNCTION public.registrar_execucao_manutencao(
  p_condominio_id uuid,
  p_subsistema text,
  p_data date,
  p_observacao text
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
  -- Sempre o dia do envio (horário de Brasília); p_data é ignorado.
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

REVOKE ALL ON FUNCTION public.pode_registrar_manutencao(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_execucao_manutencao(uuid, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_registrar_manutencao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_execucao_manutencao(uuid, text, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
