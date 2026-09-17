-- CCA Unificado — Administrador do sistema
-- Rode o ARQUIVO INTEIRO no SQL Editor.
-- Cria o tipo, as funções, a tela (RPC) e o usuário inicial.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS gestao_tecnica BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS admin_sistema BOOLEAN NOT NULL DEFAULT FALSE;

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
    RETURN;
  END IF;

  INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
  SELECT p_usuario_id, d.id, v_cargo, TRUE
  FROM public.condominios d
  ON CONFLICT (usuario_id, condominio_id) DO UPDATE
    SET cargo_id = EXCLUDED.cargo_id,
        ativo = TRUE;
END;
$$;

-- ------------------------------------------------------------
-- Autorização
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.eh_admin_sistema(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT u.admin_sistema
      FROM public.usuarios u
      WHERE u.id = uid
        AND u.ativo IS TRUE
    ), FALSE)
    OR (
      uid = auth.uid()
      AND (
        COALESCE((auth.jwt() -> 'user_metadata' ->> 'admin_sistema')::boolean, FALSE)
        OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'admin_sistema')::boolean, FALSE)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.user_is_admin_sistema()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.eh_admin_sistema(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.eh_gestao_tecnica(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.eh_admin_sistema(uid)
    OR COALESCE((
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

CREATE OR REPLACE FUNCTION public.impedir_auto_promocao_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.admin_sistema IS DISTINCT FROM OLD.admin_sistema
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Somente o SQL Editor / service role pode marcar Administrador do sistema';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_impedir_auto_promocao_admin ON public.usuarios;
CREATE TRIGGER trg_impedir_auto_promocao_admin
BEFORE UPDATE OF admin_sistema ON public.usuarios
FOR EACH ROW
EXECUTE FUNCTION public.impedir_auto_promocao_admin();

-- ------------------------------------------------------------
-- Criar Gestão Técnica (somente Administrador do sistema no app)
-- No SQL Editor, auth.uid() é nulo e o postgres continua podendo criar.
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
  IF auth.uid() IS NOT NULL AND NOT public.user_is_admin_sistema() THEN
    RAISE EXCEPTION 'Somente o Administrador do sistema pode criar Gestão Técnica';
  END IF;

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
      created_at, updated_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
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
      NOW(), NOW(),
      '', '', '', '', '', '', '', ''
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
        confirmation_token = COALESCE(confirmation_token, ''),
        recovery_token = COALESCE(recovery_token, ''),
        email_change_token_new = COALESCE(email_change_token_new, ''),
        email_change = COALESCE(email_change, ''),
        email_change_token_current = COALESCE(email_change_token_current, ''),
        reauthentication_token = COALESCE(reauthentication_token, ''),
        phone_change = COALESCE(phone_change, ''),
        phone_change_token = COALESCE(phone_change_token, ''),
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

CREATE OR REPLACE FUNCTION public.listar_usuarios_gestao_tecnica()
RETURNS TABLE (
  id uuid,
  nome text,
  email text,
  ativo boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_admin_sistema() THEN
    RAISE EXCEPTION 'Somente o Administrador do sistema pode listar Gestão Técnica';
  END IF;

  RETURN QUERY
  SELECT u.id, u.nome, u.email, u.ativo, u.updated_at
  FROM public.usuarios u
  WHERE u.gestao_tecnica IS TRUE
    AND COALESCE(u.admin_sistema, FALSE) IS FALSE
  ORDER BY u.nome, u.email;
END;
$$;

-- ------------------------------------------------------------
-- Criar Administrador do sistema (somente SQL Editor)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_usuario_admin_sistema(
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
  v_nome text := COALESCE(
    NULLIF(trim(COALESCE(p_nome, '')), ''),
    'Administrador do sistema'
  );
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
      created_at, updated_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(p_senha, extensions.gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'nome', v_nome,
        'gestao_tecnica', true,
        'admin_sistema', true
      ),
      NOW(), NOW(),
      '', '', '', '', '', '', '', ''
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
        confirmation_token = COALESCE(confirmation_token, ''),
        recovery_token = COALESCE(recovery_token, ''),
        email_change_token_new = COALESCE(email_change_token_new, ''),
        email_change = COALESCE(email_change, ''),
        email_change_token_current = COALESCE(email_change_token_current, ''),
        reauthentication_token = COALESCE(reauthentication_token, ''),
        phone_change = COALESCE(phone_change, ''),
        phone_change_token = COALESCE(phone_change_token, ''),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object(
            'nome', v_nome,
            'gestao_tecnica', true,
            'admin_sistema', true
          ),
        updated_at = NOW()
    WHERE id = v_id;
  END IF;

  INSERT INTO public.usuarios (id, nome, email, ativo, gestao_tecnica, admin_sistema)
  VALUES (v_id, v_nome, v_email, TRUE, TRUE, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET nome = EXCLUDED.nome,
        email = EXCLUDED.email,
        ativo = TRUE,
        gestao_tecnica = TRUE,
        admin_sistema = TRUE,
        updated_at = NOW();

  PERFORM public.vincular_gestao_a_todos_condominios(v_id);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.user_is_admin_sistema() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_usuario_admin_sistema(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.criar_usuario_gestao_tecnica(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.listar_usuarios_gestao_tecnica() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_is_admin_sistema() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.eh_admin_sistema(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.criar_usuario_gestao_tecnica(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_gestao_tecnica() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Usuário inicial. Falha aqui não desfaz as funções acima.
DO $$
BEGIN
  PERFORM public.criar_usuario_admin_sistema(
    'montenegrogabriel351@gmail.com',
    '920200@!',
    'Administrador do sistema'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Admin do sistema: %', SQLERRM;
END $$;
