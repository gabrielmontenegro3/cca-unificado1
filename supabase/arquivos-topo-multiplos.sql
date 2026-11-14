-- Telas com arquivos no topo passam a aceitar VÁRIOS arquivos (antes, um novo substituía o anterior):
--   * Fornecedores, Materiais e Garantias (catalogo_arquivos_principais)
--   * Manual de uso (manuais_uso)
-- Os arquivos já publicados continuam lá.
-- Pré-requisito: catalogo-arquivo-principal.sql e manual-uso.sql já rodados.
-- Rode o ARQUIVO INTEIRO no SQL Editor do Supabase.

-- 1) Arquivos das telas do catálogo: uma linha por arquivo.
ALTER TABLE public.catalogo_arquivos_principais
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.catalogo_arquivos_principais
  ADD COLUMN IF NOT EXISTS ordem integer NOT NULL DEFAULT 0;
ALTER TABLE public.catalogo_arquivos_principais
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  -- A chave antiga (condomínio + tela) só permitia um arquivo por tela.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'catalogo_arquivos_principais_pkey'
      AND conrelid = 'public.catalogo_arquivos_principais'::regclass
      AND array_length(conkey, 1) = 2
  ) THEN
    ALTER TABLE public.catalogo_arquivos_principais DROP CONSTRAINT catalogo_arquivos_principais_pkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.catalogo_arquivos_principais'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.catalogo_arquivos_principais ADD PRIMARY KEY (id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS catalogo_arquivos_principais_tela_idx
  ON public.catalogo_arquivos_principais (condominio_id, tela, ordem);

-- 2) Manual de uso: vários PDFs por condomínio.
ALTER TABLE public.manuais_uso
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.manuais_uso
  ADD COLUMN IF NOT EXISTS ordem integer NOT NULL DEFAULT 0;
ALTER TABLE public.manuais_uso
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  -- A chave antiga (condomínio) só permitia um manual por condomínio.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conname = 'manuais_uso_pkey'
      AND c.conrelid = 'public.manuais_uso'::regclass
      AND a.attname = 'condominio_id'
  ) THEN
    ALTER TABLE public.manuais_uso DROP CONSTRAINT manuais_uso_pkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.manuais_uso'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.manuais_uso ADD PRIMARY KEY (id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS manuais_uso_condo_idx
  ON public.manuais_uso (condominio_id, ordem);

NOTIFY pgrst, 'reload schema';
