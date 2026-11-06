-- Manutenção: sistema construtivo -> subsistemas.
-- Cada execução registra primeiro o sistema construtivo (ex.: Hidráulica)
-- e depois um subsistema dele (ex.: Água fria).
-- Pré-requisito: manutencao-execucoes-relatorio.sql e manutencao-execucao-arquivos.sql já rodados.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

-- 1) Sistemas construtivos de cada condomínio.
CREATE TABLE IF NOT EXISTS public.manutencao_sistemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (condominio_id, nome)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manutencao_sistemas TO authenticated;
ALTER TABLE public.manutencao_sistemas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS msis_select ON public.manutencao_sistemas;
DROP POLICY IF EXISTS msis_write ON public.manutencao_sistemas;
CREATE POLICY msis_select ON public.manutencao_sistemas
  FOR SELECT TO authenticated
  USING (public.pode_ver_manutencao(condominio_id));
CREATE POLICY msis_write ON public.manutencao_sistemas
  FOR ALL TO authenticated
  USING (public.pode_registrar_manutencao(condominio_id))
  WITH CHECK (public.pode_registrar_manutencao(condominio_id));

-- 2) Subsistema passa a pertencer a um sistema. O mesmo nome pode existir em sistemas diferentes.
ALTER TABLE public.manutencao_subsistemas
  ADD COLUMN IF NOT EXISTS sistema text NOT NULL DEFAULT '';
ALTER TABLE public.manutencao_subsistemas
  DROP CONSTRAINT IF EXISTS manutencao_subsistemas_condominio_id_nome_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'manutencao_subsistemas_condo_sistema_nome_key'
  ) THEN
    ALTER TABLE public.manutencao_subsistemas
      ADD CONSTRAINT manutencao_subsistemas_condo_sistema_nome_key UNIQUE (condominio_id, sistema, nome);
  END IF;
END;
$$;

-- 3) A execução guarda o sistema também.
ALTER TABLE public.manutencao_registros
  ADD COLUMN IF NOT EXISTS sistema text;

-- 4) Dados antigos: o que era escolhido como "subsistema" era, na prática, o sistema.
UPDATE public.manutencao_registros
SET sistema = subsistema
WHERE sistema IS NULL;

INSERT INTO public.manutencao_sistemas (condominio_id, nome)
SELECT DISTINCT condominio_id, trim(nome)
FROM (
  SELECT condominio_id, sistema AS nome FROM public.manutencoes_preventivas
  UNION ALL
  SELECT condominio_id, sistema FROM public.manutencao_registros
  UNION ALL
  SELECT condominio_id, nome FROM public.manutencao_subsistemas WHERE sistema = ''
) AS antigos
WHERE NULLIF(trim(COALESCE(nome, '')), '') IS NOT NULL
ON CONFLICT (condominio_id, nome) DO NOTHING;

-- 5) Registrar execução: sistema + subsistema (data sempre o dia do envio).
DROP FUNCTION IF EXISTS public.registrar_execucao_manutencao(uuid, text, date, text);
DROP FUNCTION IF EXISTS public.registrar_execucao_manutencao(uuid, text, date, text, uuid[]);
DROP FUNCTION IF EXISTS public.registrar_execucao_manutencao(uuid, text, text, date, text, uuid[]);

CREATE FUNCTION public.registrar_execucao_manutencao(
  p_condominio_id uuid,
  p_sistema text,
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
  v_sistema text;
  v_nome text;
  v_id uuid;
  -- p_data fica na assinatura só por compatibilidade e é ignorado.
  v_data date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.pode_registrar_manutencao(p_condominio_id) THEN
    RAISE EXCEPTION 'Somente o síndico registra a execução';
  END IF;
  v_sistema := NULLIF(trim(COALESCE(p_sistema, '')), '');
  IF v_sistema IS NULL THEN
    RAISE EXCEPTION 'Informe o sistema construtivo';
  END IF;
  v_nome := NULLIF(trim(COALESCE(p_subsistema, '')), '');
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Informe o subsistema';
  END IF;

  INSERT INTO public.manutencao_sistemas (condominio_id, nome)
  VALUES (p_condominio_id, v_sistema)
  ON CONFLICT (condominio_id, nome) DO NOTHING;

  INSERT INTO public.manutencao_subsistemas (condominio_id, sistema, nome)
  VALUES (p_condominio_id, v_sistema, v_nome)
  ON CONFLICT (condominio_id, sistema, nome) DO NOTHING;

  INSERT INTO public.manutencao_registros (
    condominio_id, sistema, subsistema, data_execucao, observacao, executado_por
  )
  VALUES (
    p_condominio_id,
    v_sistema,
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

  -- O cronograma é por sistema construtivo.
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
    AND lower(trim(sistema)) = lower(v_sistema);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_execucao_manutencao(uuid, text, text, date, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_execucao_manutencao(uuid, text, text, date, text, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
