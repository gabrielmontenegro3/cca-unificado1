-- Especificidade do chamado (preenchida pela Gestão Técnica no atendimento).
-- Alimenta os gráficos do sistema da construtora.

ALTER TABLE public.chamados ADD COLUMN IF NOT EXISTS local_problema text;
ALTER TABLE public.chamados ADD COLUMN IF NOT EXISTS subsistema text;
ALTER TABLE public.chamados ADD COLUMN IF NOT EXISTS tipo_problema text;
ALTER TABLE public.chamados ADD COLUMN IF NOT EXISTS especificidade_em timestamptz;
ALTER TABLE public.chamados ADD COLUMN IF NOT EXISTS especificidade_por uuid REFERENCES public.usuarios(id);

CREATE INDEX IF NOT EXISTS chamados_especificidade_idx
  ON public.chamados (condominio_id, local_problema, subsistema, tipo_problema);

NOTIFY pgrst, 'reload schema';
