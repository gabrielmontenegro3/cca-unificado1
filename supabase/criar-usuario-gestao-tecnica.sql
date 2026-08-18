-- Cria a função (se ainda não existir) e em seguida o usuário Gestão Técnica.
-- Rode o ARQUIVO INTEIRO no SQL Editor (não só o SELECT).
-- Troque e-mail, senha e nome no SELECT do final.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS gestao_tecnica BOOLEAN NOT NULL DEFAULT FALSE;

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

GRANT EXECUTE ON FUNCTION public.criar_usuario_gestao_tecnica(text, text, text) TO postgres;

-- Troque os três valores abaixo e rode o arquivo inteiro.
SELECT public.criar_usuario_gestao_tecnica(
  'gestao@seudominio.com'::text,
  'TroqueEstaSenha1'::text,
  'Gestão Técnica'::text
);
