-- CCA Unificado — RLS, funções de autorização, trigger de perfil e Storage
-- Execute no SQL Editor do Supabase DEPOIS do schema principal.
-- Não recria tabelas.

-- ------------------------------------------------------------
-- FK que o schema original deixou de fora (conversas.laudo_id)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversas_laudo_id_fkey'
  ) THEN
    ALTER TABLE public.conversas
      ADD CONSTRAINT conversas_laudo_id_fkey
      FOREIGN KEY (laudo_id) REFERENCES public.laudos_tecnicos(id)
      ON DELETE CASCADE;
  END IF;
END $$;


-- ------------------------------------------------------------
-- Perfil público ao criar usuário no Auth
-- ------------------------------------------------------------
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS gestao_tecnica BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usuarios (id, nome, email, gestao_tecnica)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'nome',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'gestao_tecnica')::boolean, FALSE)
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();


-- ------------------------------------------------------------
-- Funções de autorização (SECURITY DEFINER para evitar recursão de RLS)
-- ------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.user_cargo_tipo(cid uuid)
RETURNS public.tipo_cargo
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.user_is_gestao_tecnica() THEN 'gestao_tecnica'::public.tipo_cargo
    ELSE (
      SELECT c.tipo
      FROM public.usuario_condominio uc
      JOIN public.cargos c ON c.id = uc.cargo_id
      WHERE uc.usuario_id = auth.uid()
        AND uc.condominio_id = cid
        AND uc.ativo IS TRUE
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_staff(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_cargo_tipo(cid) IN (
    'administrador'::public.tipo_cargo,
    'gestao_tecnica'::public.tipo_cargo,
    'administracao'::public.tipo_cargo
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_admin(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_cargo_tipo(cid) = 'administrador'::public.tipo_cargo;
$$;

CREATE OR REPLACE FUNCTION public.user_is_gestao(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_cargo_tipo(cid) IN (
    'administrador'::public.tipo_cargo,
    'gestao_tecnica'::public.tipo_cargo
  );
$$;

CREATE OR REPLACE FUNCTION public.shares_condominio_with(target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_gestao_tecnica()
  OR EXISTS (
    SELECT 1
    FROM public.usuario_condominio a
    JOIN public.usuario_condominio b ON b.condominio_id = a.condominio_id
    WHERE a.usuario_id = auth.uid()
      AND a.ativo IS TRUE
      AND b.usuario_id = target
      AND b.ativo IS TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.user_participates(conversa uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversa_participantes cp
    WHERE cp.conversa_id = conversa
      AND cp.usuario_id = auth.uid()
      AND cp.saiu_em IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.vincular_gestao_a_todos_condominios(p_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cargo uuid;
BEGIN
  IF p_usuario_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_cargo
  FROM public.cargos
  WHERE tipo = 'gestao_tecnica'::public.tipo_cargo
  LIMIT 1;

  IF v_cargo IS NULL THEN
    RAISE EXCEPTION 'Cargo gestao_tecnica não cadastrado';
  END IF;

  INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
  SELECT p_usuario_id, d.id, v_cargo, TRUE
  FROM public.condominios d
  ON CONFLICT (usuario_id, condominio_id) DO UPDATE
    SET cargo_id = EXCLUDED.cargo_id,
        ativo = TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.vincular_todas_gestoes_ao_condominio(p_condominio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cargo uuid;
BEGIN
  SELECT id INTO v_cargo
  FROM public.cargos
  WHERE tipo = 'gestao_tecnica'::public.tipo_cargo
  LIMIT 1;

  IF v_cargo IS NULL THEN
    RAISE EXCEPTION 'Cargo gestao_tecnica não cadastrado';
  END IF;

  INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
  SELECT u.id, p_condominio_id, v_cargo, TRUE
  FROM public.usuarios u
  WHERE u.gestao_tecnica IS TRUE
    AND u.ativo IS TRUE
  ON CONFLICT (usuario_id, condominio_id) DO UPDATE
    SET cargo_id = EXCLUDED.cargo_id,
        ativo = TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.after_condominio_insert_gestao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.vincular_todas_gestoes_ao_condominio(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_condominio_vincula_gestao ON public.condominios;
CREATE TRIGGER trg_condominio_vincula_gestao
AFTER INSERT ON public.condominios
FOR EACH ROW
EXECUTE FUNCTION public.after_condominio_insert_gestao();

CREATE OR REPLACE FUNCTION public.after_usuario_gestao_tecnica()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.gestao_tecnica IS TRUE AND NEW.ativo IS TRUE THEN
    PERFORM public.vincular_gestao_a_todos_condominios(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usuario_gestao_tecnica ON public.usuarios;
CREATE TRIGGER trg_usuario_gestao_tecnica
AFTER INSERT OR UPDATE OF gestao_tecnica, ativo ON public.usuarios
FOR EACH ROW
EXECUTE FUNCTION public.after_usuario_gestao_tecnica();

CREATE OR REPLACE FUNCTION public.criar_condominio(
  p_nome text,
  p_cnpj text DEFAULT NULL,
  p_descricao text DEFAULT NULL
)
RETURNS uuid
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

  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode criar condomínio';
  END IF;

  IF p_nome IS NULL OR length(trim(p_nome)) < 2 THEN
    RAISE EXCEPTION 'Informe o nome do condomínio';
  END IF;

  INSERT INTO public.condominios (nome, cnpj, descricao)
  VALUES (
    trim(p_nome),
    NULLIF(trim(COALESCE(p_cnpj, '')), ''),
    NULLIF(trim(COALESCE(p_descricao, '')), '')
  )
  RETURNING id INTO v_condo;

  RETURN v_condo;
END;
$$;

CREATE OR REPLACE FUNCTION public.vincular_usuario_ao_condominio(
  p_email text,
  p_condominio_id uuid,
  p_tipo public.tipo_cargo
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_cargo uuid;
BEGIN
  IF p_tipo = 'gestao_tecnica'::public.tipo_cargo THEN
    RAISE EXCEPTION 'Gestão Técnica não se vincula a um condomínio. Use criar_usuario_gestao_tecnica.';
  END IF;

  SELECT id INTO v_user
  FROM public.usuarios
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Usuário % não encontrado. Crie o login no Auth primeiro.', p_email;
  END IF;

  IF public.eh_gestao_tecnica(v_user) THEN
    RAISE EXCEPTION 'Este usuário é Gestão Técnica e já está em todos os condomínios';
  END IF;

  SELECT id INTO v_cargo FROM public.cargos WHERE tipo = p_tipo LIMIT 1;
  IF v_cargo IS NULL THEN
    RAISE EXCEPTION 'Cargo % não cadastrado', p_tipo;
  END IF;

  INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
  VALUES (v_user, p_condominio_id, v_cargo, TRUE)
  ON CONFLICT (usuario_id, condominio_id) DO UPDATE
    SET cargo_id = EXCLUDED.cargo_id, ativo = TRUE;

  RETURN v_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.criar_usuario_gestao_tecnica(
  p_email text,
  p_senha text,
  p_nome text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_id uuid;
  v_email text := lower(trim(p_email));
  v_nome text := COALESCE(NULLIF(trim(COALESCE(p_nome, '')), ''), split_part(lower(trim(p_email)), '@', 1));
BEGIN
  IF v_email IS NULL OR v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido';
  END IF;
  IF p_senha IS NULL OR length(p_senha) < 8 THEN
    RAISE EXCEPTION 'A senha deve ter pelo menos 8 caracteres';
  END IF;

  SELECT id INTO v_id FROM auth.users WHERE lower(email) = v_email;

  IF v_id IS NULL THEN
    v_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt(p_senha, extensions.gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', v_nome, 'gestao_tecnica', true),
      NOW(), NOW(), '', '', '', ''
    );
    IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_id AND provider = 'email') THEN
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_id,
        jsonb_build_object('sub', v_id::text, 'email', v_email),
        'email', v_id::text, NOW(), NOW(), NOW()
      );
    END IF;
  ELSE
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object('nome', v_nome, 'gestao_tecnica', true),
        updated_at = NOW()
    WHERE id = v_id;
  END IF;

  INSERT INTO public.usuarios (id, nome, email, ativo, gestao_tecnica)
  VALUES (v_id, v_nome, v_email, TRUE, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET nome = EXCLUDED.nome, email = EXCLUDED.email, ativo = TRUE,
        gestao_tecnica = TRUE, updated_at = NOW();

  PERFORM public.vincular_gestao_a_todos_condominios(v_id);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.user_is_gestao_tecnica() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_condominio(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_belongs_to_condominio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_cargo_tipo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_gestao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_gestao_tecnica() TO authenticated;
GRANT EXECUTE ON FUNCTION public.eh_gestao_tecnica(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_condominio(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_participates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_condominio_with(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.criar_usuario_gestao_tecnica(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vincular_usuario_ao_condominio(text, uuid, public.tipo_cargo) FROM PUBLIC, anon, authenticated;


-- Participantes padrão ao criar conversa (evita o morador precisar ler usuario_condominio)
CREATE OR REPLACE FUNCTION public.after_conversa_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tipo = 'chamado' THEN
    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT NEW.id, c.solicitante_id
    FROM public.chamados c
    WHERE c.id = NEW.chamado_id
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;

    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT NEW.id, uc.usuario_id
    FROM public.usuario_condominio uc
    JOIN public.cargos cg ON cg.id = uc.cargo_id
    WHERE uc.condominio_id = NEW.condominio_id
      AND uc.ativo IS TRUE
      AND cg.tipo IN ('gestao_tecnica'::public.tipo_cargo, 'administrador'::public.tipo_cargo)
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;
  ELSIF NEW.tipo = 'laudo' THEN
    INSERT INTO public.conversa_participantes (conversa_id, usuario_id)
    SELECT NEW.id, uc.usuario_id
    FROM public.usuario_condominio uc
    JOIN public.cargos cg ON cg.id = uc.cargo_id
    WHERE uc.condominio_id = NEW.condominio_id
      AND uc.ativo IS TRUE
      AND cg.tipo IN (
        'gestao_tecnica'::public.tipo_cargo,
        'administrador'::public.tipo_cargo,
        'administracao'::public.tipo_cargo,
        'construtora'::public.tipo_cargo
      )
    ON CONFLICT (conversa_id, usuario_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversa_participantes ON public.conversas;
CREATE TRIGGER trg_conversa_participantes
AFTER INSERT ON public.conversas
FOR EACH ROW
EXECUTE FUNCTION public.after_conversa_insert();


-- Realtime do chat
ALTER TABLE public.mensagens REPLICA IDENTITY FULL;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mensagens;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.condominios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enderecos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_condominio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidade_moradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visao_geral_secoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empreendimento_secoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_empreendimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imagens_condominio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sobre_nos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boletins_informativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boletim_arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_locais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garantias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_garantias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedor_garantias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manutencoes_preventivas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manutencao_arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manutencao_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chamados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chamado_status_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chamado_arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversa_participantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagem_arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laudos_tecnicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laudo_arquivos ENABLE ROW LEVEL SECURITY;

-- cargos
DROP POLICY IF EXISTS cargos_select ON public.cargos;
CREATE POLICY cargos_select ON public.cargos
  FOR SELECT TO authenticated
  USING (true);

-- condominios
DROP POLICY IF EXISTS condominios_select ON public.condominios;
DROP POLICY IF EXISTS condominios_update ON public.condominios;
CREATE POLICY condominios_select ON public.condominios
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(id)
  );
CREATE POLICY condominios_update ON public.condominios
  FOR UPDATE TO authenticated
  USING (public.user_is_gestao_tecnica())
  WITH CHECK (public.user_is_gestao_tecnica());

-- enderecos
DROP POLICY IF EXISTS enderecos_select ON public.enderecos;
DROP POLICY IF EXISTS enderecos_write ON public.enderecos;
CREATE POLICY enderecos_select ON public.enderecos
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY enderecos_write ON public.enderecos
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica() OR public.user_belongs_to_condominio(condominio_id))
  WITH CHECK (public.user_is_gestao_tecnica());

-- usuarios
DROP POLICY IF EXISTS usuarios_select ON public.usuarios;
DROP POLICY IF EXISTS usuarios_update ON public.usuarios;
CREATE POLICY usuarios_select ON public.usuarios
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_condominio_with(id));
CREATE POLICY usuarios_update ON public.usuarios
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- usuario_condominio
DROP POLICY IF EXISTS uc_select ON public.usuario_condominio;
DROP POLICY IF EXISTS uc_write ON public.usuario_condominio;
CREATE POLICY uc_select ON public.usuario_condominio
  FOR SELECT TO authenticated
  USING (
    usuario_id = auth.uid()
    OR public.user_is_staff(condominio_id)
  );
CREATE POLICY uc_write ON public.usuario_condominio
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

-- unidades
DROP POLICY IF EXISTS unidades_select ON public.unidades;
DROP POLICY IF EXISTS unidades_write ON public.unidades;
CREATE POLICY unidades_select ON public.unidades
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY unidades_write ON public.unidades
  FOR ALL TO authenticated
  USING (public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_staff(condominio_id));

-- unidade_moradores
DROP POLICY IF EXISTS um_select ON public.unidade_moradores;
DROP POLICY IF EXISTS um_write ON public.unidade_moradores;
CREATE POLICY um_select ON public.unidade_moradores
  FOR SELECT TO authenticated
  USING (
    usuario_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.unidades u
      WHERE u.id = unidade_id
        AND public.user_is_staff(u.condominio_id)
    )
  );
CREATE POLICY um_write ON public.unidade_moradores
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.unidades u
      WHERE u.id = unidade_id AND public.user_is_staff(u.condominio_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.unidades u
      WHERE u.id = unidade_id AND public.user_is_staff(u.condominio_id)
    )
  );

-- conteúdo institucional (leitura: membro; escrita: staff)
DROP POLICY IF EXISTS vg_select ON public.visao_geral_secoes;
DROP POLICY IF EXISTS vg_write ON public.visao_geral_secoes;
CREATE POLICY vg_select ON public.visao_geral_secoes
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY vg_write ON public.visao_geral_secoes
  FOR ALL TO authenticated
  USING (public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS emp_select ON public.empreendimento_secoes;
DROP POLICY IF EXISTS emp_write ON public.empreendimento_secoes;
CREATE POLICY emp_select ON public.empreendimento_secoes
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY emp_write ON public.empreendimento_secoes
  FOR ALL TO authenticated
  USING (public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS docs_select ON public.documentos_empreendimento;
DROP POLICY IF EXISTS docs_write ON public.documentos_empreendimento;
CREATE POLICY docs_select ON public.documentos_empreendimento
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY docs_write ON public.documentos_empreendimento
  FOR ALL TO authenticated
  USING (public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS img_select ON public.imagens_condominio;
DROP POLICY IF EXISTS img_write ON public.imagens_condominio;
CREATE POLICY img_select ON public.imagens_condominio
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY img_write ON public.imagens_condominio
  FOR ALL TO authenticated
  USING (public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS ct_select ON public.contatos;
DROP POLICY IF EXISTS ct_write ON public.contatos;
CREATE POLICY ct_select ON public.contatos
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    AND (ativo IS TRUE OR public.user_is_gestao(condominio_id))
  );
CREATE POLICY ct_write ON public.contatos
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS sn_select ON public.sobre_nos;
DROP POLICY IF EXISTS sn_write ON public.sobre_nos;
CREATE POLICY sn_select ON public.sobre_nos
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY sn_write ON public.sobre_nos
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

-- boletins: só administrador e Gestão Técnica criam; morador só lê publicados
DROP POLICY IF EXISTS bol_select ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_write ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_insert ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_update ON public.boletins_informativos;
DROP POLICY IF EXISTS bol_delete ON public.boletins_informativos;
CREATE POLICY bol_select ON public.boletins_informativos
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    AND (
      publicado IS TRUE
      OR public.user_is_gestao(condominio_id)
      OR public.user_is_gestao_tecnica()
    )
  );
CREATE POLICY bol_insert ON public.boletins_informativos
  FOR INSERT TO authenticated
  WITH CHECK (
    autor_id = auth.uid()
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_is_gestao(condominio_id)
    )
  );
CREATE POLICY bol_update ON public.boletins_informativos
  FOR UPDATE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  )
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );
CREATE POLICY bol_delete ON public.boletins_informativos
  FOR DELETE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );

DROP POLICY IF EXISTS ba_select ON public.boletim_arquivos;
DROP POLICY IF EXISTS ba_write ON public.boletim_arquivos;
CREATE POLICY ba_select ON public.boletim_arquivos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boletins_informativos b
      WHERE b.id = boletim_id
        AND public.user_belongs_to_condominio(b.condominio_id)
        AND (b.publicado IS TRUE OR public.user_is_gestao(b.condominio_id) OR public.user_is_gestao_tecnica())
    )
  );
CREATE POLICY ba_write ON public.boletim_arquivos
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boletins_informativos b
      WHERE b.id = boletim_id AND (
        public.user_is_gestao_tecnica()
        OR public.user_is_gestao(b.condominio_id)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boletins_informativos b
      WHERE b.id = boletim_id AND (
        public.user_is_gestao_tecnica()
        OR public.user_is_gestao(b.condominio_id)
      )
    )
  );

-- base técnica: todo o condomínio lê; só gestão/administrador grava
DROP POLICY IF EXISTS forn_select ON public.fornecedores;
DROP POLICY IF EXISTS forn_write ON public.fornecedores;
CREATE POLICY forn_select ON public.fornecedores
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY forn_write ON public.fornecedores
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS mat_select ON public.materiais;
DROP POLICY IF EXISTS mat_write ON public.materiais;
CREATE POLICY mat_select ON public.materiais
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY mat_write ON public.materiais
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS loc_select ON public.locais;
DROP POLICY IF EXISTS loc_write ON public.locais;
CREATE POLICY loc_select ON public.locais
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY loc_write ON public.locais
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS gar_select ON public.garantias;
DROP POLICY IF EXISTS gar_write ON public.garantias;
CREATE POLICY gar_select ON public.garantias
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_condominio(condominio_id));
CREATE POLICY gar_write ON public.garantias
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS ml_all ON public.material_locais;
CREATE POLICY ml_all ON public.material_locais
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id
        AND (public.user_is_staff(m.condominio_id) OR public.user_is_gestao(m.condominio_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id
        AND (public.user_is_gestao(m.condominio_id) OR public.user_is_admin(m.condominio_id))
    )
  );

DROP POLICY IF EXISTS mg_all ON public.material_garantias;
CREATE POLICY mg_all ON public.material_garantias
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id
        AND (public.user_is_staff(m.condominio_id) OR public.user_is_gestao(m.condominio_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.materiais m
      WHERE m.id = material_id
        AND (public.user_is_gestao(m.condominio_id) OR public.user_is_admin(m.condominio_id))
    )
  );

DROP POLICY IF EXISTS fg_all ON public.fornecedor_garantias;
CREATE POLICY fg_all ON public.fornecedor_garantias
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.garantias g
      WHERE g.id = garantia_id
        AND (public.user_is_staff(g.condominio_id) OR public.user_is_gestao(g.condominio_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.garantias g
      WHERE g.id = garantia_id
        AND (public.user_is_gestao(g.condominio_id) OR public.user_is_admin(g.condominio_id))
    )
  );

-- manutenção
DROP POLICY IF EXISTS man_select ON public.manutencoes_preventivas;
DROP POLICY IF EXISTS man_write ON public.manutencoes_preventivas;
DROP POLICY IF EXISTS man_insert ON public.manutencoes_preventivas;
DROP POLICY IF EXISTS man_update ON public.manutencoes_preventivas;
DROP POLICY IF EXISTS man_delete ON public.manutencoes_preventivas;
CREATE POLICY man_select ON public.manutencoes_preventivas
  FOR SELECT TO authenticated
  USING (
    public.user_belongs_to_condominio(condominio_id)
    OR public.user_is_gestao_tecnica()
  );
CREATE POLICY man_insert ON public.manutencoes_preventivas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );
CREATE POLICY man_update ON public.manutencoes_preventivas
  FOR UPDATE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  )
  WITH CHECK (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );
CREATE POLICY man_delete ON public.manutencoes_preventivas
  FOR DELETE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_is_gestao(condominio_id)
  );

DROP POLICY IF EXISTS ma_all ON public.manutencao_arquivos;
CREATE POLICY ma_all ON public.manutencao_arquivos
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.manutencoes_preventivas m
      WHERE m.id = manutencao_id AND public.user_is_staff(m.condominio_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.manutencoes_preventivas m
      WHERE m.id = manutencao_id
        AND (
          public.user_is_gestao_tecnica()
          OR public.user_is_gestao(m.condominio_id)
        )
    )
  );

DROP POLICY IF EXISTS mex_select ON public.manutencao_execucoes;
DROP POLICY IF EXISTS mex_write ON public.manutencao_execucoes;
CREATE POLICY mex_select ON public.manutencao_execucoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.manutencoes_preventivas m
      WHERE m.id = manutencao_id
        AND (
          public.user_belongs_to_condominio(m.condominio_id)
          OR public.user_is_gestao_tecnica()
        )
    )
  );
CREATE POLICY mex_write ON public.manutencao_execucoes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.manutencoes_preventivas m
      WHERE m.id = manutencao_id
        AND (
          public.user_is_gestao_tecnica()
          OR public.user_is_gestao(m.condominio_id)
        )
    )
  );

-- arquivos
DROP POLICY IF EXISTS arq_select ON public.arquivos;
DROP POLICY IF EXISTS arq_insert ON public.arquivos;
DROP POLICY IF EXISTS arq_delete ON public.arquivos;
CREATE POLICY arq_select ON public.arquivos
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(condominio_id)
  );
CREATE POLICY arq_insert ON public.arquivos
  FOR INSERT TO authenticated
  WITH CHECK (
    enviado_por = auth.uid()
    AND (
      public.user_is_gestao_tecnica()
      OR public.user_belongs_to_condominio(condominio_id)
    )
  );
CREATE POLICY arq_delete ON public.arquivos
  FOR DELETE TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR enviado_por = auth.uid()
    OR public.user_belongs_to_condominio(condominio_id)
  );

-- chamados
DROP POLICY IF EXISTS ch_select ON public.chamados;
DROP POLICY IF EXISTS ch_insert ON public.chamados;
DROP POLICY IF EXISTS ch_update ON public.chamados;
CREATE POLICY ch_select ON public.chamados
  FOR SELECT TO authenticated
  USING (
    public.user_is_staff(condominio_id)
    OR solicitante_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.conversas cv
      WHERE cv.chamado_id = chamados.id
        AND public.user_participates(cv.id)
    )
  );
CREATE POLICY ch_insert ON public.chamados
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_belongs_to_condominio(condominio_id)
    AND solicitante_id = auth.uid()
  );
CREATE POLICY ch_update ON public.chamados
  FOR UPDATE TO authenticated
  USING (public.user_is_gestao(condominio_id) OR public.user_is_staff(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id) OR public.user_is_staff(condominio_id));

DROP POLICY IF EXISTS csh_select ON public.chamado_status_historico;
DROP POLICY IF EXISTS csh_insert ON public.chamado_status_historico;
CREATE POLICY csh_select ON public.chamado_status_historico
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chamados c
      WHERE c.id = chamado_id
        AND (
          public.user_is_staff(c.condominio_id)
          OR c.solicitante_id = auth.uid()
        )
    )
  );
CREATE POLICY csh_insert ON public.chamado_status_historico
  FOR INSERT TO authenticated
  WITH CHECK (
    alterado_por = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chamados c
      WHERE c.id = chamado_id
        AND (
          public.user_is_gestao(c.condominio_id)
          OR (
            c.solicitante_id = auth.uid()
            AND status_novo = 'aberto'::public.status_chamado
            AND status_anterior IS NULL
          )
        )
    )
  );

DROP POLICY IF EXISTS ca_select ON public.chamado_arquivos;
DROP POLICY IF EXISTS ca_insert ON public.chamado_arquivos;
CREATE POLICY ca_select ON public.chamado_arquivos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chamados c
      WHERE c.id = chamado_id
        AND (
          public.user_is_staff(c.condominio_id)
          OR c.solicitante_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.conversas cv
            WHERE cv.chamado_id = c.id AND public.user_participates(cv.id)
          )
        )
    )
  );
CREATE POLICY ca_insert ON public.chamado_arquivos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chamados c
      WHERE c.id = chamado_id
        AND (c.solicitante_id = auth.uid() OR public.user_is_staff(c.condominio_id))
    )
  );

-- conversas / chat: só participantes
DROP POLICY IF EXISTS conv_select ON public.conversas;
DROP POLICY IF EXISTS conv_insert ON public.conversas;
CREATE POLICY conv_select ON public.conversas
  FOR SELECT TO authenticated
  USING (public.user_participates(id) OR public.user_is_gestao(condominio_id));
CREATE POLICY conv_insert ON public.conversas
  FOR INSERT TO authenticated
  WITH CHECK (public.user_belongs_to_condominio(condominio_id));

DROP POLICY IF EXISTS cp_select ON public.conversa_participantes;
DROP POLICY IF EXISTS cp_insert ON public.conversa_participantes;
CREATE POLICY cp_select ON public.conversa_participantes
  FOR SELECT TO authenticated
  USING (
    usuario_id = auth.uid()
    OR public.user_participates(conversa_id)
    OR EXISTS (
      SELECT 1 FROM public.conversas cv
      WHERE cv.id = conversa_id AND public.user_is_gestao(cv.condominio_id)
    )
  );
CREATE POLICY cp_insert ON public.conversa_participantes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversas cv
      WHERE cv.id = conversa_id
        AND public.user_belongs_to_condominio(cv.condominio_id)
    )
  );

DROP POLICY IF EXISTS msg_select ON public.mensagens;
DROP POLICY IF EXISTS msg_insert ON public.mensagens;
DROP POLICY IF EXISTS msg_update ON public.mensagens;
CREATE POLICY msg_select ON public.mensagens
  FOR SELECT TO authenticated
  USING (public.user_participates(conversa_id));
CREATE POLICY msg_insert ON public.mensagens
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_participates(conversa_id)
    AND usuario_id = auth.uid()
  );
CREATE POLICY msg_update ON public.mensagens
  FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid() AND public.user_participates(conversa_id))
  WITH CHECK (usuario_id = auth.uid());

DROP POLICY IF EXISTS marq_select ON public.mensagem_arquivos;
DROP POLICY IF EXISTS marq_insert ON public.mensagem_arquivos;
CREATE POLICY marq_select ON public.mensagem_arquivos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mensagens m
      WHERE m.id = mensagem_id AND public.user_participates(m.conversa_id)
    )
  );
CREATE POLICY marq_insert ON public.mensagem_arquivos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mensagens m
      WHERE m.id = mensagem_id
        AND m.usuario_id = auth.uid()
        AND public.user_participates(m.conversa_id)
    )
  );

-- laudos
DROP POLICY IF EXISTS lau_select ON public.laudos_tecnicos;
DROP POLICY IF EXISTS lau_insert ON public.laudos_tecnicos;
DROP POLICY IF EXISTS lau_update ON public.laudos_tecnicos;
CREATE POLICY lau_select ON public.laudos_tecnicos
  FOR SELECT TO authenticated
  USING (
    public.user_is_staff(condominio_id)
    OR EXISTS (
      SELECT 1 FROM public.conversas cv
      WHERE cv.laudo_id = laudos_tecnicos.id
        AND public.user_participates(cv.id)
    )
  );
CREATE POLICY lau_insert ON public.laudos_tecnicos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_is_gestao(condominio_id)
    AND criado_por = auth.uid()
  );
CREATE POLICY lau_update ON public.laudos_tecnicos
  FOR UPDATE TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));

DROP POLICY IF EXISTS la_select ON public.laudo_arquivos;
DROP POLICY IF EXISTS la_insert ON public.laudo_arquivos;
CREATE POLICY la_select ON public.laudo_arquivos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.laudos_tecnicos l
      WHERE l.id = laudo_id
        AND (
          public.user_is_staff(l.condominio_id)
          OR EXISTS (
            SELECT 1 FROM public.conversas cv
            WHERE cv.laudo_id = l.id AND public.user_participates(cv.id)
          )
        )
    )
  );
CREATE POLICY la_insert ON public.laudo_arquivos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.laudos_tecnicos l
      WHERE l.id = laudo_id AND public.user_is_gestao(l.condominio_id)
    )
  );


-- ------------------------------------------------------------
-- Storage
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('condominios', 'condominios', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_condo_select ON storage.objects;
DROP POLICY IF EXISTS storage_condo_insert ON storage.objects;
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
