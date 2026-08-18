-- CCA Unificado — isolamento por condomínio + Gestão Técnica global
-- Cole no SQL Editor do Supabase e execute (Run).
--
-- Regras:
--   Administrador, Construtora e Morador veem só o condomínio ao qual estão vinculados.
--   Gestão Técnica vê todos e fica vinculada a todos (inclusive os que forem criados depois).
--
-- Depois rode o comando em: criar-usuario-gestao-tecnica.sql

-- ------------------------------------------------------------
-- Flag global no perfil
-- ------------------------------------------------------------
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS gestao_tecnica BOOLEAN NOT NULL DEFAULT FALSE;

-- Quem já tinha o cargo em algum condomínio passa a ser Gestão Técnica global
UPDATE public.usuarios u
SET gestao_tecnica = TRUE
WHERE u.gestao_tecnica IS FALSE
  AND EXISTS (
    SELECT 1
    FROM public.usuario_condominio uc
    JOIN public.cargos c ON c.id = uc.cargo_id
    WHERE uc.usuario_id = u.id
      AND uc.ativo IS TRUE
      AND c.tipo = 'gestao_tecnica'::public.tipo_cargo
  );


-- ------------------------------------------------------------
-- Funções de autorização
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


-- ------------------------------------------------------------
-- Vincular Gestão Técnica a todos os condomínios
-- ------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.impedir_auto_promocao_gestao()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.gestao_tecnica IS DISTINCT FROM OLD.gestao_tecnica
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Somente o SQL Editor / service role pode marcar Gestão Técnica';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_impedir_auto_promocao_gestao ON public.usuarios;
CREATE TRIGGER trg_impedir_auto_promocao_gestao
BEFORE UPDATE OF gestao_tecnica ON public.usuarios
FOR EACH ROW
EXECUTE FUNCTION public.impedir_auto_promocao_gestao();


-- ------------------------------------------------------------
-- Criar condomínio (somente Gestão Técnica) e atrelar todas as GTs
-- ------------------------------------------------------------
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


-- ------------------------------------------------------------
-- Vincular Administrador / Construtora / Morador a UM condomínio
-- ------------------------------------------------------------
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

  SELECT id INTO v_cargo
  FROM public.cargos
  WHERE tipo = p_tipo
  LIMIT 1;

  IF v_cargo IS NULL THEN
    RAISE EXCEPTION 'Cargo % não cadastrado', p_tipo;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.condominios WHERE id = p_condominio_id) THEN
    RAISE EXCEPTION 'Condomínio não encontrado';
  END IF;

  INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
  VALUES (v_user, p_condominio_id, v_cargo, TRUE)
  ON CONFLICT (usuario_id, condominio_id) DO UPDATE
    SET cargo_id = EXCLUDED.cargo_id,
        ativo = TRUE;

  RETURN v_user;
END;
$$;


-- ------------------------------------------------------------
-- Criar usuário Gestão Técnica (login + perfil + vínculo com todos)
-- Execute no SQL Editor. Não exponha esta função ao frontend.
-- ------------------------------------------------------------
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
      v_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(p_senha, extensions.gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', v_nome, 'gestao_tecnica', true),
      NOW(), NOW(), '', '', '', ''
    );

    IF NOT EXISTS (
      SELECT 1 FROM auth.identities WHERE user_id = v_id AND provider = 'email'
    ) THEN
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        v_id,
        jsonb_build_object('sub', v_id::text, 'email', v_email),
        'email',
        v_id::text,
        NOW(), NOW(), NOW()
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
    SET nome = EXCLUDED.nome,
        email = EXCLUDED.email,
        ativo = TRUE,
        gestao_tecnica = TRUE,
        updated_at = NOW();

  PERFORM public.vincular_gestao_a_todos_condominios(v_id);

  RETURN v_id;
END;
$$;


-- Perfil ao criar login no Auth
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


-- ------------------------------------------------------------
-- Policies: Gestão Técnica vê todos; os demais só o próprio condomínio
-- ------------------------------------------------------------
DROP POLICY IF EXISTS condominios_select ON public.condominios;
CREATE POLICY condominios_select ON public.condominios
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(id)
  );

DROP POLICY IF EXISTS condominios_update ON public.condominios;
CREATE POLICY condominios_update ON public.condominios
  FOR UPDATE TO authenticated
  USING (public.user_is_gestao_tecnica())
  WITH CHECK (public.user_is_gestao_tecnica());

DROP POLICY IF EXISTS enderecos_write ON public.enderecos;
CREATE POLICY enderecos_write ON public.enderecos
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica())
  WITH CHECK (public.user_is_gestao_tecnica());

DROP POLICY IF EXISTS uc_write ON public.usuario_condominio;
CREATE POLICY uc_write ON public.usuario_condominio
  FOR ALL TO authenticated
  USING (public.user_is_gestao(condominio_id))
  WITH CHECK (public.user_is_gestao(condominio_id));


-- ------------------------------------------------------------
-- Permissões
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.criar_usuario_gestao_tecnica(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vincular_usuario_ao_condominio(text, uuid, public.tipo_cargo) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_is_gestao_tecnica() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_condominio(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_belongs_to_condominio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_cargo_tipo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_gestao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_gestao_tecnica() TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_condominio(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_participates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_condominio_with(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eh_gestao_tecnica(uuid) TO authenticated;


-- Aplica o vínculo em quem já era GT e nos condomínios já existentes
SELECT public.vincular_gestao_a_todos_condominios(u.id)
FROM public.usuarios u
WHERE u.gestao_tecnica IS TRUE
  AND u.ativo IS TRUE;
