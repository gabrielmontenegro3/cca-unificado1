-- Meu imóvel por condomínio e ficha do tipo de apartamento.
-- Rode antes o arquivo supabase/tipos-apartamento.sql, se ainda não rodou.
-- Depois rode ESTE ARQUIVO INTEIRO no SQL Editor do Supabase.

DO $$
BEGIN
  IF to_regclass('public.tipos_apartamento') IS NULL THEN
    RAISE EXCEPTION 'Rode primeiro o arquivo supabase/tipos-apartamento.sql';
  END IF;
END $$;

ALTER TABLE public.tipos_apartamento
  ADD COLUMN IF NOT EXISTS planta_arquivo_id uuid REFERENCES public.arquivos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area_privativa text,
  ADD COLUMN IF NOT EXISTS area_total text,
  ADD COLUMN IF NOT EXISTS dormitorios text,
  ADD COLUMN IF NOT EXISTS suites text,
  ADD COLUMN IF NOT EXISTS banheiros text,
  ADD COLUMN IF NOT EXISTS lavabo text,
  ADD COLUMN IF NOT EXISTS vagas text,
  ADD COLUMN IF NOT EXISTS varanda text,
  ADD COLUMN IF NOT EXISTS orientacao text,
  ADD COLUMN IF NOT EXISTS pe_direito text,
  ADD COLUMN IF NOT EXISTS posicao text,
  ADD COLUMN IF NOT EXISTS dependencias text,
  ADD COLUMN IF NOT EXISTS diferenciais text;

ALTER TABLE public.usuario_condominio
  ADD COLUMN IF NOT EXISTS tipo_apartamento_id uuid REFERENCES public.tipos_apartamento(id) ON DELETE SET NULL;

ALTER TABLE public.convites
  ADD COLUMN IF NOT EXISTS tipo_apartamento_id uuid REFERENCES public.tipos_apartamento(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.meu_imovel_secoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  texto text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meu_imovel_secoes_condo_idx
  ON public.meu_imovel_secoes (condominio_id, ordem);

CREATE TABLE IF NOT EXISTS public.tipo_apartamento_secoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_id uuid NOT NULL REFERENCES public.tipos_apartamento(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  texto text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tipo_apartamento_secoes_tipo_idx
  ON public.tipo_apartamento_secoes (tipo_id, ordem);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meu_imovel_secoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tipo_apartamento_secoes TO authenticated;

ALTER TABLE public.meu_imovel_secoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipo_apartamento_secoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meu_imovel_select ON public.meu_imovel_secoes;
DROP POLICY IF EXISTS meu_imovel_write ON public.meu_imovel_secoes;
CREATE POLICY meu_imovel_select ON public.meu_imovel_secoes
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY meu_imovel_write ON public.meu_imovel_secoes
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS tas_select ON public.tipo_apartamento_secoes;
DROP POLICY IF EXISTS tas_write ON public.tipo_apartamento_secoes;
CREATE POLICY tas_select ON public.tipo_apartamento_secoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tipos_apartamento t
      WHERE t.id = tipo_id
        AND (
          public.user_belongs_to_condominio(t.condominio_id)
          OR public.user_is_gestao_tecnica()
        )
    )
  );
CREATE POLICY tas_write ON public.tipo_apartamento_secoes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tipos_apartamento t
      WHERE t.id = tipo_id
        AND (public.user_is_gestao_tecnica() OR public.user_is_staff(t.condominio_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tipos_apartamento t
      WHERE t.id = tipo_id
        AND (public.user_is_gestao_tecnica() OR public.user_is_staff(t.condominio_id))
    )
  );

CREATE OR REPLACE FUNCTION public.definir_tipo_apartamento_usuario(
  p_condominio_id uuid,
  p_usuario_id uuid,
  p_tipo_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_condo uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT (public.user_is_gestao_tecnica() OR public.user_is_staff(p_condominio_id)) THEN
    RAISE EXCEPTION 'Sem permissão para definir o tipo de apartamento';
  END IF;
  IF p_tipo_id IS NOT NULL THEN
    SELECT condominio_id INTO v_condo
    FROM public.tipos_apartamento
    WHERE id = p_tipo_id;
    IF v_condo IS NULL OR v_condo <> p_condominio_id THEN
      RAISE EXCEPTION 'Esse tipo de apartamento não pertence a este condomínio';
    END IF;
  END IF;
  UPDATE public.usuario_condominio
  SET tipo_apartamento_id = p_tipo_id
  WHERE usuario_id = p_usuario_id
    AND condominio_id = p_condominio_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário ainda não está vinculado a este condomínio';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.definir_tipo_convite(
  p_token text,
  p_tipo_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_condo uuid;
  v_tipo_condo uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  SELECT condominio_id INTO v_condo
  FROM public.convites
  WHERE token = p_token
    AND usado_em IS NULL;
  IF v_condo IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado';
  END IF;
  IF NOT (public.user_is_gestao_tecnica() OR public.user_is_staff(v_condo)) THEN
    RAISE EXCEPTION 'Sem permissão para definir o tipo de apartamento';
  END IF;
  IF p_tipo_id IS NOT NULL THEN
    SELECT condominio_id INTO v_tipo_condo
    FROM public.tipos_apartamento
    WHERE id = p_tipo_id;
    IF v_tipo_condo IS NULL OR v_tipo_condo <> v_condo THEN
      RAISE EXCEPTION 'Esse tipo de apartamento não pertence a este condomínio';
    END IF;
  END IF;
  UPDATE public.convites
  SET tipo_apartamento_id = p_tipo_id
  WHERE token = p_token
    AND usado_em IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.copiar_tipo_apartamento_do_convite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.usado_por IS NOT NULL
     AND NEW.tipo_apartamento_id IS NOT NULL
     AND NEW.condominio_id IS NOT NULL THEN
    UPDATE public.usuario_condominio
    SET tipo_apartamento_id = NEW.tipo_apartamento_id
    WHERE usuario_id = NEW.usado_por
      AND condominio_id = NEW.condominio_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS convite_copia_tipo_apto ON public.convites;
CREATE TRIGGER convite_copia_tipo_apto
  AFTER UPDATE OF usado_em ON public.convites
  FOR EACH ROW
  WHEN (NEW.usado_em IS NOT NULL AND OLD.usado_em IS NULL)
  EXECUTE FUNCTION public.copiar_tipo_apartamento_do_convite();

REVOKE ALL ON FUNCTION public.definir_tipo_apartamento_usuario(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.definir_tipo_convite(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.definir_tipo_apartamento_usuario(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_tipo_convite(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
