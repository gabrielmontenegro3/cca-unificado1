-- Corrige "structure of query does not match function result type"
-- ao criar/listar usuário da construtora.
-- Rode o ARQUIVO INTEIRO no SQL Editor.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS foto_path text;

DROP FUNCTION IF EXISTS public.criar_usuario_construtora(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.criar_usuario_construtora(uuid, text, text, text, uuid[]);

CREATE OR REPLACE FUNCTION public.criar_usuario_construtora(
  p_construtora_id uuid,
  p_email text,
  p_senha text,
  p_nome text DEFAULT NULL,
  p_escopo_condominio_ids uuid[] DEFAULT NULL
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
  IF auth.uid() IS NOT NULL AND NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode criar usuário da construtora';
  END IF;
  IF p_construtora_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.construtoras WHERE id = p_construtora_id) THEN
    RAISE EXCEPTION 'Construtora não encontrada';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido';
  END IF;
  IF p_senha IS NULL OR length(p_senha) < 8 THEN
    RAISE EXCEPTION 'A senha deve ter pelo menos 8 caracteres';
  END IF;

  SELECT au.id INTO v_id FROM auth.users au WHERE lower(au.email) = v_email;

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
      jsonb_build_object('nome', v_nome, 'construtora', true),
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
        gen_random_uuid()::text,
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
          || jsonb_build_object('nome', v_nome, 'construtora', true),
        updated_at = NOW()
    WHERE id = v_id;
  END IF;

  INSERT INTO public.usuarios (id, nome, email, ativo, construtora_id)
  VALUES (v_id, v_nome, v_email, TRUE, p_construtora_id)
  ON CONFLICT (id) DO UPDATE
    SET nome = EXCLUDED.nome,
        email = EXCLUDED.email,
        ativo = TRUE,
        construtora_id = EXCLUDED.construtora_id,
        updated_at = NOW();

  PERFORM public.aplicar_escopo_construtora(v_id, p_construtora_id, p_escopo_condominio_ids);
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.listar_usuarios_construtora(uuid);

CREATE OR REPLACE FUNCTION public.listar_usuarios_construtora(p_construtora_id uuid)
RETURNS TABLE (
  id uuid,
  nome text,
  email text,
  ativo boolean,
  created_at timestamptz,
  foto_path text,
  todos_condominios boolean,
  condominios jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode listar usuários da construtora';
  END IF;
  IF p_construtora_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    q.uid,
    q.nome_out,
    q.email_out,
    q.ativo_out,
    q.created_out,
    q.foto_out,
    q.todos_out,
    q.condos_out
  FROM (
    SELECT
      u.id AS uid,
      u.nome::text AS nome_out,
      u.email::text AS email_out,
      COALESCE(u.ativo, TRUE)::boolean AS ativo_out,
      u.updated_at AS created_out,
      u.foto_path::text AS foto_out,
      (NOT EXISTS (
        SELECT 1 FROM public.usuario_construtora_escopo e WHERE e.usuario_id = u.id
      ))::boolean AS todos_out,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.nome) ORDER BY d.nome)
        FROM public.usuario_construtora_escopo e
        JOIN public.condominios d ON d.id = e.condominio_id
        WHERE e.usuario_id = u.id
      ), '[]'::jsonb) AS condos_out
    FROM public.usuarios u
    WHERE u.construtora_id = p_construtora_id
  ) q
  ORDER BY q.nome_out, q.email_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_usuario_construtora(uuid, text, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_construtora(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
