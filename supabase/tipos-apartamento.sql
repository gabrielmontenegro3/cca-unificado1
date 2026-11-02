-- Tipos de apartamento (A, B, C…) e os arquivos de cada um.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.tipos_apartamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descricao text,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tipos_apartamento_condo_idx
  ON public.tipos_apartamento (condominio_id, ordem);

CREATE TABLE IF NOT EXISTS public.tipo_apartamento_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_id uuid NOT NULL REFERENCES public.tipos_apartamento(id) ON DELETE CASCADE,
  arquivo_id uuid NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tipo_apartamento_arquivos_tipo_idx
  ON public.tipo_apartamento_arquivos (tipo_id, ordem);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tipos_apartamento TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tipo_apartamento_arquivos TO authenticated;

ALTER TABLE public.tipos_apartamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipo_apartamento_arquivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tap_select ON public.tipos_apartamento;
DROP POLICY IF EXISTS tap_write ON public.tipos_apartamento;
CREATE POLICY tap_select ON public.tipos_apartamento
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY tap_write ON public.tipos_apartamento
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica() OR public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS tap_arq_select ON public.tipo_apartamento_arquivos;
DROP POLICY IF EXISTS tap_arq_write ON public.tipo_apartamento_arquivos;
CREATE POLICY tap_arq_select ON public.tipo_apartamento_arquivos
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
CREATE POLICY tap_arq_write ON public.tipo_apartamento_arquivos
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
