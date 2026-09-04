-- Rastreabilidade de chamados: linha do tempo, inspeções, repasses, etc.
-- Somente Gestão Técnica acessa. Rode no SQL Editor do Supabase.
-- Se já rodou a versão anterior, rode de novo: as tabelas não são recriadas e as policies são substituídas.

CREATE TABLE IF NOT EXISTS public.chamado_rastreabilidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id uuid NOT NULL REFERENCES public.chamados(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (
    tipo IN (
      'atendimento',
      'inspecao',
      'inspecao_agendada',
      'apontamento',
      'repasse_construtora',
      'repasse_administracao',
      'atualizacao_cliente',
      'comunicado_construtora',
      'acao_construtora'
    )
  ),
  titulo text,
  descricao text,
  registrado_por uuid NOT NULL REFERENCES public.usuarios(id),
  parent_id uuid REFERENCES public.chamado_rastreabilidade(id) ON DELETE SET NULL,
  numero_inspecao smallint,
  data_ocorrencia timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chamado_rastreabilidade_chamado
  ON public.chamado_rastreabilidade(chamado_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chamado_rastreabilidade_parent
  ON public.chamado_rastreabilidade(parent_id);

CREATE TABLE IF NOT EXISTS public.chamado_rastreabilidade_atendentes (
  rastreabilidade_id uuid NOT NULL REFERENCES public.chamado_rastreabilidade(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  PRIMARY KEY (rastreabilidade_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS public.chamado_rastreabilidade_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rastreabilidade_id uuid NOT NULL REFERENCES public.chamado_rastreabilidade(id) ON DELETE CASCADE,
  arquivo_id uuid NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE,
  descricao_foto text,
  UNIQUE (rastreabilidade_id, arquivo_id)
);

-- RLS
ALTER TABLE public.chamado_rastreabilidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chamado_rastreabilidade_atendentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chamado_rastreabilidade_arquivos ENABLE ROW LEVEL SECURITY;

-- Somente Gestão Técnica lê e registra. Rode de novo se já aplicou a versão anterior.
DROP POLICY IF EXISTS cr_select ON public.chamado_rastreabilidade;
CREATE POLICY cr_select ON public.chamado_rastreabilidade
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR (
      tipo = 'inspecao_agendada'
      AND EXISTS (
        SELECT 1
        FROM public.chamados c
        WHERE c.id = chamado_id
          AND (
            c.solicitante_id = auth.uid()
            OR public.user_is_staff(c.condominio_id)
          )
      )
    )
  );

DROP POLICY IF EXISTS cr_insert ON public.chamado_rastreabilidade;
CREATE POLICY cr_insert ON public.chamado_rastreabilidade
  FOR INSERT TO authenticated
  WITH CHECK (
    registrado_por = auth.uid()
    AND public.user_is_gestao_tecnica()
  );

DROP POLICY IF EXISTS cra_select ON public.chamado_rastreabilidade_atendentes;
CREATE POLICY cra_select ON public.chamado_rastreabilidade_atendentes
  FOR SELECT TO authenticated
  USING (public.user_is_gestao_tecnica());

DROP POLICY IF EXISTS cra_insert ON public.chamado_rastreabilidade_atendentes;
CREATE POLICY cra_insert ON public.chamado_rastreabilidade_atendentes
  FOR INSERT TO authenticated
  WITH CHECK (public.user_is_gestao_tecnica());

DROP POLICY IF EXISTS crf_select ON public.chamado_rastreabilidade_arquivos;
CREATE POLICY crf_select ON public.chamado_rastreabilidade_arquivos
  FOR SELECT TO authenticated
  USING (public.user_is_gestao_tecnica());

DROP POLICY IF EXISTS crf_insert ON public.chamado_rastreabilidade_arquivos;
CREATE POLICY crf_insert ON public.chamado_rastreabilidade_arquivos
  FOR INSERT TO authenticated
  WITH CHECK (public.user_is_gestao_tecnica());

GRANT SELECT, INSERT ON public.chamado_rastreabilidade TO authenticated;
GRANT SELECT, INSERT ON public.chamado_rastreabilidade_atendentes TO authenticated;
GRANT SELECT, INSERT ON public.chamado_rastreabilidade_arquivos TO authenticated;

-- Instalações antigas: inclui inspecao_agendada no CHECK (CREATE TABLE IF NOT EXISTS não altera o constraint).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.chamado_rastreabilidade'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%tipo%'
  LOOP
    EXECUTE format('ALTER TABLE public.chamado_rastreabilidade DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.chamado_rastreabilidade
  ADD CONSTRAINT chamado_rastreabilidade_tipo_check CHECK (
    tipo IN (
      'atendimento',
      'inspecao',
      'inspecao_agendada',
      'apontamento',
      'repasse_construtora',
      'repasse_administracao',
      'atualizacao_cliente',
      'comunicado_construtora',
      'acao_construtora'
    )
  );

NOTIFY pgrst, 'reload schema';
