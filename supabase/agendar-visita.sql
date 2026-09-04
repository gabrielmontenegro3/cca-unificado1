-- Permite o tipo inspecao_agendada na rastreabilidade (Agendar visita).
-- Rode no SQL Editor do Supabase. Não cria inspeção: só o agendamento.

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

-- Morador (solicitante) e staff do condomínio podem ver só o agendamento da visita.
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

NOTIFY pgrst, 'reload schema';
