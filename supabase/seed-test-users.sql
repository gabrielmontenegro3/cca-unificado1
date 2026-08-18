-- CCA Unificado — usuários de teste
-- Cole no SQL Editor do Supabase e execute (Run).
-- Idempotente: pode rodar de novo sem duplicar.
-- O primeiro condomínio existe para a Gestão Técnica já nascer com o cargo;
-- os próximos empreendimentos ela cria no app (tela Condomínios).

DO $$
DECLARE
  v_condo_id uuid;
  v_admin_id uuid;
  v_gestao_id uuid;
  v_construtora_id uuid;
  v_cargo_admin uuid;
  v_cargo_gestao uuid;
  v_cargo_construtora uuid;
  v_password text := extensions.crypt('TesteCCA2026!', extensions.gen_salt('bf'));
BEGIN
  SELECT id INTO v_cargo_admin FROM public.cargos WHERE tipo = 'administrador';
  SELECT id INTO v_cargo_gestao FROM public.cargos WHERE tipo = 'gestao_tecnica';
  SELECT id INTO v_cargo_construtora FROM public.cargos WHERE tipo = 'construtora';

  IF v_cargo_admin IS NULL OR v_cargo_gestao IS NULL OR v_cargo_construtora IS NULL THEN
    RAISE EXCEPTION 'Cargos iniciais não encontrados. Rode o INSERT de cargos do schema.';
  END IF;

  INSERT INTO public.condominios (nome, descricao)
  SELECT 'Residencial Teste CCA', 'Condomínio de teste para validar os papéis do sistema.'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.condominios WHERE nome = 'Residencial Teste CCA'
  );

  SELECT id INTO v_condo_id
  FROM public.condominios
  WHERE nome = 'Residencial Teste CCA'
  LIMIT 1;

  -- Administrador
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin.teste@example.com';
  IF v_admin_id IS NULL THEN
    v_admin_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_admin_id,
      'authenticated',
      'authenticated',
      'admin.teste@example.com',
      v_password,
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"nome":"Administrador Teste"}'::jsonb,
      NOW(), NOW(), '', '', '', ''
    );
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_admin_id,
      jsonb_build_object('sub', v_admin_id::text, 'email', 'admin.teste@example.com'),
      'email',
      v_admin_id::text,
      NOW(), NOW(), NOW()
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = v_password,
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"nome":"Administrador Teste"}'::jsonb
    WHERE id = v_admin_id;
  END IF;

  INSERT INTO public.usuarios (id, nome, email, ativo)
  VALUES (v_admin_id, 'Administrador Teste', 'admin.teste@example.com', TRUE)
  ON CONFLICT (id) DO UPDATE
    SET nome = EXCLUDED.nome, email = EXCLUDED.email, ativo = TRUE, updated_at = NOW();

  -- Gestão Técnica
  SELECT id INTO v_gestao_id FROM auth.users WHERE email = 'gestao.teste@example.com';
  IF v_gestao_id IS NULL THEN
    v_gestao_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_gestao_id,
      'authenticated',
      'authenticated',
      'gestao.teste@example.com',
      v_password,
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"nome":"Gestão Técnica Teste"}'::jsonb,
      NOW(), NOW(), '', '', '', ''
    );
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_gestao_id,
      jsonb_build_object('sub', v_gestao_id::text, 'email', 'gestao.teste@example.com'),
      'email',
      v_gestao_id::text,
      NOW(), NOW(), NOW()
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = v_password,
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"nome":"Gestão Técnica Teste"}'::jsonb
    WHERE id = v_gestao_id;
  END IF;

  INSERT INTO public.usuarios (id, nome, email, ativo, gestao_tecnica)
  VALUES (v_gestao_id, 'Gestão Técnica Teste', 'gestao.teste@example.com', TRUE, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET nome = EXCLUDED.nome, email = EXCLUDED.email, ativo = TRUE, gestao_tecnica = TRUE, updated_at = NOW();

  -- Construtora
  SELECT id INTO v_construtora_id FROM auth.users WHERE email = 'construtora.teste@example.com';
  IF v_construtora_id IS NULL THEN
    v_construtora_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_construtora_id,
      'authenticated',
      'authenticated',
      'construtora.teste@example.com',
      v_password,
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"nome":"Construtora Teste"}'::jsonb,
      NOW(), NOW(), '', '', '', ''
    );
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_construtora_id,
      jsonb_build_object('sub', v_construtora_id::text, 'email', 'construtora.teste@example.com'),
      'email',
      v_construtora_id::text,
      NOW(), NOW(), NOW()
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = v_password,
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"nome":"Construtora Teste"}'::jsonb
    WHERE id = v_construtora_id;
  END IF;

  INSERT INTO public.usuarios (id, nome, email, ativo)
  VALUES (v_construtora_id, 'Construtora Teste', 'construtora.teste@example.com', TRUE)
  ON CONFLICT (id) DO UPDATE
    SET nome = EXCLUDED.nome, email = EXCLUDED.email, ativo = TRUE, updated_at = NOW();

  INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
  VALUES
    (v_admin_id, v_condo_id, v_cargo_admin, TRUE),
    (v_gestao_id, v_condo_id, v_cargo_gestao, TRUE),
    (v_construtora_id, v_condo_id, v_cargo_construtora, TRUE)
  ON CONFLICT (usuario_id, condominio_id) DO UPDATE
    SET cargo_id = EXCLUDED.cargo_id, ativo = TRUE;
END $$;

SELECT
  u.email,
  u.nome,
  c.tipo AS cargo,
  d.nome AS condominio
FROM public.usuario_condominio uc
JOIN public.usuarios u ON u.id = uc.usuario_id
JOIN public.cargos c ON c.id = uc.cargo_id
JOIN public.condominios d ON d.id = uc.condominio_id
WHERE u.email IN (
  'admin.teste@example.com',
  'gestao.teste@example.com',
  'construtora.teste@example.com'
)
ORDER BY c.tipo;
