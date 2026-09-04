-- Cria criar_condominio (com endereço), as funções de permissão e o RLS.
-- Rode o ARQUIVO INTEIRO no SQL Editor, do primeiro ao último comando (No limit).
-- Não rode só o trecho da policy: a função user_belongs_to_condominio precisa existir antes.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS gestao_tecnica BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.condominios ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.condominios ADD COLUMN IF NOT EXISTS logo_path text;
ALTER TABLE public.condominios ADD COLUMN IF NOT EXISTS imagem_visao_geral_path text;
ALTER TABLE public.condominios ADD COLUMN IF NOT EXISTS imagem_capa_path text;
ALTER TABLE public.condominios ADD COLUMN IF NOT EXISTS imagem_login_path text;

-- Tira a policy antiga para o CREATE FUNCTION não depender dela.
DROP POLICY IF EXISTS enderecos_write ON public.enderecos;

CREATE OR REPLACE FUNCTION public.eh_gestao_tecnica(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT u.gestao_tecnica
      FROM public.usuarios u
      WHERE u.id = uid
        AND u.ativo IS TRUE
    ), FALSE)
    OR (
      uid = auth.uid()
      AND (
        COALESCE((auth.jwt() -> 'user_metadata' ->> 'gestao_tecnica')::boolean, FALSE)
        OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'gestao_tecnica')::boolean, FALSE)
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.usuario_condominio uc
      JOIN public.cargos c ON c.id = uc.cargo_id
      WHERE uc.usuario_id = uid
        AND uc.ativo IS TRUE
        AND c.tipo = 'gestao_tecnica'::public.tipo_cargo
    );
$$;

CREATE OR REPLACE FUNCTION public.user_is_gestao_tecnica()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.eh_gestao_tecnica(auth.uid());
$$;

-- Não use DROP aqui: policies do Storage e das tabelas dependem desta função.
CREATE OR REPLACE FUNCTION public.user_belongs_to_condominio(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
  OR EXISTS (
    SELECT 1
    FROM public.usuario_condominio uc
    WHERE uc.usuario_id = auth.uid()
      AND uc.condominio_id = cid
      AND uc.ativo IS TRUE
  );
$$;

DROP FUNCTION IF EXISTS public.criar_condominio(text, text, text);
DROP FUNCTION IF EXISTS public.criar_condominio(text, text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.criar_condominio(text, text, text, text, text, text, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.criar_condominio(
  p_nome text,
  p_cnpj text DEFAULT NULL,
  p_descricao text DEFAULT NULL,
  p_cep text DEFAULT NULL,
  p_logradouro text DEFAULT NULL,
  p_numero text DEFAULT NULL,
  p_complemento text DEFAULT NULL,
  p_bairro text DEFAULT NULL,
  p_cidade text DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_seed jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_condo uuid;
  v_item jsonb;
  v_forn uuid;
  v_mat uuid;
  v_loc uuid;
  v_gar uuid;
  v_nome text;
  v_cargo uuid;
  v_user uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode criar condomínio';
  END IF;

  IF p_nome IS NULL OR length(trim(p_nome)) < 2 THEN
    RAISE EXCEPTION 'Informe o nome do condomínio';
  END IF;

  INSERT INTO public.condominios (nome, cnpj, descricao, email)
  VALUES (
    trim(p_nome),
    NULLIF(trim(COALESCE(p_cnpj, '')), ''),
    NULLIF(trim(COALESCE(p_descricao, '')), ''),
    NULLIF(trim(COALESCE(p_seed->>'email', '')), '')
  )
  RETURNING id INTO v_condo;

  IF COALESCE(trim(p_cep), '') <> ''
     OR COALESCE(trim(p_logradouro), '') <> ''
     OR COALESCE(trim(p_cidade), '') <> ''
     OR COALESCE(trim(p_bairro), '') <> ''
     OR COALESCE(trim(p_estado), '') <> ''
     OR COALESCE(trim(p_numero), '') <> '' THEN
    INSERT INTO public.enderecos (
      condominio_id, cep, logradouro, numero, complemento, bairro, cidade, estado, pais
    ) VALUES (
      v_condo,
      NULLIF(trim(COALESCE(p_cep, '')), ''),
      NULLIF(trim(COALESCE(p_logradouro, '')), ''),
      NULLIF(trim(COALESCE(p_numero, '')), ''),
      NULLIF(trim(COALESCE(p_complemento, '')), ''),
      NULLIF(trim(COALESCE(p_bairro, '')), ''),
      NULLIF(trim(COALESCE(p_cidade, '')), ''),
      NULLIF(trim(COALESCE(p_estado, '')), ''),
      'Brasil'
    )
    ON CONFLICT (condominio_id) DO UPDATE
      SET cep = EXCLUDED.cep,
          logradouro = EXCLUDED.logradouro,
          numero = EXCLUDED.numero,
          complemento = EXCLUDED.complemento,
          bairro = EXCLUDED.bairro,
          cidade = EXCLUDED.cidade,
          estado = EXCLUDED.estado;
  END IF;

  IF p_seed IS NULL THEN
    RETURN v_condo;
  END IF;

  IF COALESCE(p_seed->>'visao_geral', '') <> '' THEN
    INSERT INTO public.visao_geral_secoes (condominio_id, titulo, texto, ordem)
    VALUES (v_condo, 'Visão geral', p_seed->>'visao_geral', 0);
  END IF;
  IF COALESCE(p_seed->>'assistencia_tecnica', '') <> '' THEN
    INSERT INTO public.visao_geral_secoes (condominio_id, titulo, texto, ordem)
    VALUES (v_condo, 'Assistência técnica', p_seed->>'assistencia_tecnica', 1);
  END IF;
  IF COALESCE(p_seed->>'sobre_empreendimento', '') <> '' THEN
    INSERT INTO public.empreendimento_secoes (condominio_id, titulo, texto, ordem)
    VALUES (v_condo, 'Sobre o empreendimento', p_seed->>'sobre_empreendimento', 0);
  END IF;
  IF COALESCE(p_seed->>'sobre_nos', '') <> '' THEN
    INSERT INTO public.sobre_nos (condominio_id, titulo, texto, ordem)
    VALUES (v_condo, 'Sobre nós', p_seed->>'sobre_nos', 0);
  END IF;
  IF COALESCE(p_seed->>'boletim_titulo', '') <> '' AND COALESCE(p_seed->>'boletim_texto', '') <> '' THEN
    INSERT INTO public.boletins_informativos (
      condominio_id, autor_id, titulo, texto, publicado, data_publicacao
    ) VALUES (
      v_condo, auth.uid(), p_seed->>'boletim_titulo', p_seed->>'boletim_texto', TRUE, NOW()
    );
  END IF;
  IF COALESCE(p_seed->>'email', '') <> '' THEN
    INSERT INTO public.contatos (condominio_id, nome, email, ordem, ativo)
    VALUES (v_condo, 'Condomínio', p_seed->>'email', 0, TRUE);
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_seed->'fornecedores', '[]'::jsonb))
  LOOP
    IF NULLIF(trim(COALESCE(v_item->>'nome', '')), '') IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.fornecedores (condominio_id, nome, cnpj, telefone, email, cidade)
    VALUES (
      v_condo, trim(v_item->>'nome'), NULLIF(v_item->>'cnpj', ''),
      NULLIF(v_item->>'telefone', ''), NULLIF(v_item->>'email', ''), NULLIF(v_item->>'cidade', '')
    );
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_seed->'materiais', '[]'::jsonb))
  LOOP
    IF NULLIF(trim(COALESCE(v_item->>'nome', '')), '') IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.materiais (condominio_id, nome, codigo, fabricante, modelo, descricao)
    VALUES (
      v_condo, trim(v_item->>'nome'), NULLIF(v_item->>'codigo', ''),
      NULLIF(v_item->>'fabricante', ''), NULLIF(v_item->>'modelo', ''), NULLIF(v_item->>'descricao', '')
    );
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_seed->'locais', '[]'::jsonb))
  LOOP
    IF NULLIF(trim(COALESCE(v_item->>'nome', '')), '') IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.locais (condominio_id, nome, tipo, bloco, descricao)
    VALUES (
      v_condo, trim(v_item->>'nome'),
      CASE lower(COALESCE(NULLIF(trim(v_item->>'tipo'), ''), 'outro'))
        WHEN 'area_comum' THEN 'area_comum'
        WHEN 'unidade' THEN 'unidade'
        WHEN 'fachada' THEN 'fachada'
        WHEN 'cobertura' THEN 'cobertura'
        WHEN 'garagem' THEN 'garagem'
        WHEN 'area_tecnica' THEN 'area_tecnica'
        ELSE 'outro'
      END,
      NULLIF(v_item->>'bloco', ''), NULLIF(v_item->>'descricao', '')
    );
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_seed->'garantias', '[]'::jsonb))
  LOOP
    IF NULLIF(trim(COALESCE(v_item->>'nome', '')), '') IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.garantias (condominio_id, nome, descricao)
    VALUES (v_condo, trim(v_item->>'nome'), NULLIF(v_item->>'descricao', ''));
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_seed->'unidades', '[]'::jsonb))
  LOOP
    IF NULLIF(trim(COALESCE(v_item->>'identificacao', '')), '') IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.unidades (condominio_id, identificacao, bloco, andar)
    VALUES (v_condo, trim(v_item->>'identificacao'), NULLIF(v_item->>'bloco', ''), NULLIF(v_item->>'andar', ''));
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_seed->'contatos', '[]'::jsonb))
  LOOP
    IF NULLIF(trim(COALESCE(v_item->>'nome', '')), '') IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.contatos (condominio_id, nome, telefone, email, subtitulo, ativo)
    VALUES (
      v_condo, trim(v_item->>'nome'), NULLIF(v_item->>'telefone', ''),
      NULLIF(v_item->>'email', ''), NULLIF(v_item->>'subtitulo', ''), TRUE
    );
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_seed->'linhas_base', '[]'::jsonb))
  LOOP
    v_forn := NULL; v_mat := NULL; v_loc := NULL; v_gar := NULL;
    v_nome := NULLIF(trim(COALESCE(v_item->>'fornecedor', '')), '');
    IF v_nome IS NOT NULL THEN
      SELECT id INTO v_forn FROM public.fornecedores WHERE condominio_id = v_condo AND lower(nome) = lower(v_nome) LIMIT 1;
      IF v_forn IS NULL THEN
        INSERT INTO public.fornecedores (condominio_id, nome) VALUES (v_condo, v_nome) RETURNING id INTO v_forn;
      END IF;
    END IF;
    v_nome := NULLIF(trim(COALESCE(v_item->>'material', '')), '');
    IF v_nome IS NOT NULL THEN
      SELECT id INTO v_mat FROM public.materiais WHERE condominio_id = v_condo AND lower(nome) = lower(v_nome) LIMIT 1;
      IF v_mat IS NULL THEN
        INSERT INTO public.materiais (condominio_id, nome) VALUES (v_condo, v_nome) RETURNING id INTO v_mat;
        IF v_forn IS NOT NULL THEN
          BEGIN
            UPDATE public.materiais SET fornecedor_id = v_forn WHERE id = v_mat;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
      END IF;
    END IF;
    v_nome := NULLIF(trim(COALESCE(v_item->>'local', '')), '');
    IF v_nome IS NOT NULL THEN
      SELECT id INTO v_loc FROM public.locais WHERE condominio_id = v_condo AND lower(nome) = lower(v_nome) LIMIT 1;
      IF v_loc IS NULL THEN
        INSERT INTO public.locais (condominio_id, nome, tipo) VALUES (v_condo, v_nome, 'outro') RETURNING id INTO v_loc;
      END IF;
    END IF;
    v_nome := NULLIF(trim(COALESCE(v_item->>'garantia', '')), '');
    IF v_nome IS NOT NULL THEN
      SELECT id INTO v_gar FROM public.garantias WHERE condominio_id = v_condo AND lower(nome) = lower(v_nome) LIMIT 1;
      IF v_gar IS NULL THEN
        INSERT INTO public.garantias (condominio_id, nome) VALUES (v_condo, v_nome) RETURNING id INTO v_gar;
      END IF;
    END IF;
    IF v_mat IS NOT NULL AND v_loc IS NOT NULL THEN
      BEGIN
        INSERT INTO public.material_locais (material_id, local_id) VALUES (v_mat, v_loc);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    IF v_mat IS NOT NULL AND v_gar IS NOT NULL THEN
      BEGIN
        INSERT INTO public.material_garantias (material_id, garantia_id) VALUES (v_mat, v_gar);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    IF v_forn IS NOT NULL AND v_gar IS NOT NULL THEN
      BEGIN
        INSERT INTO public.fornecedor_garantias (fornecedor_id, garantia_id) VALUES (v_forn, v_gar);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_seed->'usuarios', '[]'::jsonb))
  LOOP
    IF NULLIF(trim(COALESCE(v_item->>'email', '')), '') IS NULL THEN CONTINUE; END IF;
    SELECT id INTO v_user FROM public.usuarios WHERE lower(email) = lower(trim(v_item->>'email')) LIMIT 1;
    IF v_user IS NULL THEN CONTINUE; END IF;
    SELECT id INTO v_cargo FROM public.cargos
    WHERE tipo::text = lower(replace(trim(COALESCE(v_item->>'cargo', 'morador')), ' ', '_'))
    LIMIT 1;
    IF v_cargo IS NULL THEN
      SELECT id INTO v_cargo FROM public.cargos WHERE tipo = 'morador' LIMIT 1;
    END IF;
    BEGIN
      INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
      VALUES (v_user, v_condo, v_cargo, TRUE);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  RETURN v_condo;
END;
$$;

DROP POLICY IF EXISTS enderecos_write ON public.enderecos;
CREATE POLICY enderecos_write ON public.enderecos
  FOR ALL TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(condominio_id::uuid)
  )
  WITH CHECK (public.user_is_gestao_tecnica());

-- Gestão Técnica vê todos os condomínios, mesmo sem vínculo em usuario_condominio.
-- Remove qualquer policy SELECT antiga (nomes diferentes) que esconda as linhas.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'condominios'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.condominios', r.policyname);
  END LOOP;
END $$;

ALTER TABLE public.condominios ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.condominios TO authenticated;

CREATE POLICY condominios_select ON public.condominios
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR EXISTS (
      SELECT 1
      FROM public.usuario_condominio uc
      WHERE uc.usuario_id = auth.uid()
        AND uc.condominio_id = condominios.id
        AND uc.ativo IS TRUE
    )
  );

DROP FUNCTION IF EXISTS public.listar_condominios();

GRANT EXECUTE ON FUNCTION public.eh_gestao_tecnica(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_gestao_tecnica() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_belongs_to_condominio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_condominio(text, text, text, text, text, text, text, text, text, text, jsonb) TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('condominios', 'condominios', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_condo_select ON storage.objects;
DROP POLICY IF EXISTS storage_condo_insert ON storage.objects;
DROP POLICY IF EXISTS storage_condo_update ON storage.objects;
DROP POLICY IF EXISTS storage_condo_delete ON storage.objects;

CREATE POLICY storage_condo_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'condominios'
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
    )
  );

CREATE POLICY storage_condo_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'condominios'
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
    )
  );

CREATE POLICY storage_condo_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'condominios'
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
    )
  );

CREATE POLICY storage_condo_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'condominios'
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
      OR owner = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
