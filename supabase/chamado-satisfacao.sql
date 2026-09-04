-- Satisfação do cliente (1–5 estrelas) no chamado.
-- Só o solicitante avalia, e só depois que o chamado está resolvido ou encerrado.
-- Rode no SQL Editor do Supabase.

ALTER TABLE public.chamados
  ADD COLUMN IF NOT EXISTS satisfacao_estrelas smallint;

ALTER TABLE public.chamados
  DROP CONSTRAINT IF EXISTS chamados_satisfacao_estrelas_check;

ALTER TABLE public.chamados
  ADD CONSTRAINT chamados_satisfacao_estrelas_check
  CHECK (satisfacao_estrelas IS NULL OR satisfacao_estrelas BETWEEN 1 AND 5);

ALTER TABLE public.chamados
  ADD COLUMN IF NOT EXISTS satisfacao_em timestamptz;

CREATE OR REPLACE FUNCTION public.avaliar_chamado(
  p_chamado_id uuid,
  p_estrelas integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.chamados;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_estrelas IS NULL OR p_estrelas < 1 OR p_estrelas > 5 THEN
    RAISE EXCEPTION 'Escolha de 1 a 5 estrelas';
  END IF;

  SELECT * INTO v_row
  FROM public.chamados
  WHERE id = p_chamado_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado';
  END IF;
  IF v_row.solicitante_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente o solicitante pode avaliar este atendimento';
  END IF;
  IF v_row.status::text NOT IN ('resolvido', 'encerrado') THEN
    RAISE EXCEPTION 'A avaliação fica disponível quando o chamado é concluído';
  END IF;

  UPDATE public.chamados
  SET
    satisfacao_estrelas = p_estrelas,
    satisfacao_em = now()
  WHERE id = p_chamado_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'satisfacao_estrelas', v_row.satisfacao_estrelas,
    'satisfacao_em', v_row.satisfacao_em
  );
END;
$$;

REVOKE ALL ON FUNCTION public.avaliar_chamado(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.avaliar_chamado(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
