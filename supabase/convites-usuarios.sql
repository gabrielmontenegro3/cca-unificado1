-- Convites e vínculo de usuários pela Gestão Técnica.
-- Rode o ARQUIVO INTEIRO no SQL Editor.

CREATE TABLE IF NOT EXISTS public.convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text),
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  cargo public.tipo_cargo NOT NULL DEFAULT 'morador',
  email text,
  unidade_id uuid REFERENCES public.unidades(id) ON DELETE SET NULL,
  criado_por uuid REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  usado_em timestamptz,
  usado_por uuid
);

ALTER TABLE public.convites ADD COLUMN IF NOT EXISTS unidade_id uuid REFERENCES public.unidades(id) ON DELETE SET NULL;
ALTER TABLE public.convites ADD COLUMN IF NOT EXISTS unidade_texto text;
ALTER TABLE public.convites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unidades_select ON public.unidades;
CREATE POLICY unidades_select ON public.unidades
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(condominio_id)
  );

DROP POLICY IF EXISTS convites_gt ON public.convites;
CREATE POLICY convites_gt ON public.convites
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica())
  WITH CHECK (public.user_is_gestao_tecnica());

DROP POLICY IF EXISTS uc_select ON public.usuario_condominio;
CREATE POLICY uc_select ON public.usuario_condominio
  FOR SELECT TO authenticated
  USING (
    usuario_id = auth.uid()
    OR public.user_is_gestao_tecnica()
    OR public.user_belongs_to_condominio(condominio_id)
  );

CREATE OR REPLACE FUNCTION public.cargo_id_por_tipo(p_cargo text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.cargos c
  WHERE c.tipo::text = p_cargo
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.garantir_perfil_usuario(p_usuario_id uuid, p_nome text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
  v_nome text;
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário inválido';
  END IF;

  SELECT lower(email),
         COALESCE(
           NULLIF(trim(COALESCE(p_nome, '')), ''),
           NULLIF(trim(COALESCE(raw_user_meta_data->>'nome', '')), ''),
           NULLIF(trim(COALESCE(raw_user_meta_data->>'name', '')), ''),
           split_part(email, '@', 1)
         )
  INTO v_email, v_nome
  FROM auth.users
  WHERE id = p_usuario_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Login não encontrado no Auth';
  END IF;

  INSERT INTO public.usuarios (id, nome, email, ativo, gestao_tecnica)
  VALUES (p_usuario_id, v_nome, v_email, TRUE, FALSE)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        nome = COALESCE(NULLIF(trim(EXCLUDED.nome), ''), public.usuarios.nome),
        ativo = TRUE,
        updated_at = NOW();

  RETURN p_usuario_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.garantir_perfil_usuario(
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'name')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.criar_login_app(
  p_email text,
  p_senha text,
  p_nome text DEFAULT NULL,
  p_convite_token text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_id uuid;
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_nome text := COALESCE(NULLIF(trim(COALESCE(p_nome, '')), ''), split_part(lower(trim(COALESCE(p_email, ''))), '@', 1));
  v_convite public.convites;
  v_permitido boolean := FALSE;
BEGIN
  IF v_email IS NULL OR v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido';
  END IF;
  IF p_senha IS NULL OR length(p_senha) < 6 THEN
    RAISE EXCEPTION 'A senha deve ter pelo menos 6 caracteres';
  END IF;

  IF public.user_is_gestao_tecnica() THEN
    v_permitido := TRUE;
  ELSIF COALESCE(trim(p_convite_token), '') <> '' THEN
    SELECT * INTO v_convite FROM public.convites WHERE token = trim(p_convite_token);
    IF v_convite.id IS NULL THEN
      RAISE EXCEPTION 'Convite não encontrado';
    END IF;
    IF v_convite.usado_em IS NOT NULL THEN
      RAISE EXCEPTION 'Este convite já foi usado';
    END IF;
    IF v_convite.expires_at < NOW() THEN
      RAISE EXCEPTION 'Este convite expirou';
    END IF;
    IF v_convite.email IS NOT NULL AND lower(v_convite.email) <> v_email THEN
      RAISE EXCEPTION 'Este convite é para outro e-mail';
    END IF;
    v_permitido := TRUE;
  END IF;

  IF NOT v_permitido THEN
    RAISE EXCEPTION 'Não autorizado a criar login';
  END IF;

  SELECT id INTO v_id FROM auth.users WHERE lower(email) = v_email LIMIT 1;

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
      jsonb_build_object('nome', v_nome),
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
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('nome', v_nome),
        updated_at = NOW()
    WHERE id = v_id;
  END IF;

  PERFORM public.garantir_perfil_usuario(v_id, v_nome);
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.criar_convite(uuid, text, text);
DROP FUNCTION IF EXISTS public.criar_convite(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.criar_convite(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.vincular_usuario_ao_condominio(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.vincular_usuario_ao_condominio(uuid, text, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.vincular_usuario_ao_condominio(uuid, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.resolver_unidade_texto(p_condominio_id uuid, p_texto text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text;
  v_bloco text;
  v_ident text;
  v_id uuid;
BEGIN
  v_raw := trim(COALESCE(p_texto, ''));
  IF v_raw = '' THEN
    RAISE EXCEPTION 'Informe a unidade (ex.: Bloco A / Casa 12 ou Bloco B / Apt 101)';
  END IF;

  IF position('/' IN v_raw) > 0 THEN
    v_bloco := trim(split_part(v_raw, '/', 1));
    v_bloco := regexp_replace(v_bloco, '^[Bb]loco[[:space:]]+', '');
    v_ident := trim(substr(v_raw, position('/' IN v_raw) + 1));
    v_ident := regexp_replace(v_ident, '^(Casa|casa|Apartamento|apartamento|Apto|apto|Apt\.?|apt\.?)[[:space:]]+', '');
  ELSE
    v_ident := v_raw;
    v_bloco := NULL;
  END IF;

  IF v_ident = '' THEN
    RAISE EXCEPTION 'Informe a casa ou o apartamento depois da barra';
  END IF;

  SELECT u.id INTO v_id
  FROM public.unidades u
  WHERE u.condominio_id = p_condominio_id
    AND (
      lower(u.identificacao) = lower(v_raw)
      OR (
        lower(u.identificacao) = lower(v_ident)
        AND lower(COALESCE(u.bloco, '')) = lower(COALESCE(v_bloco, ''))
      )
    )
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.unidades (condominio_id, identificacao, bloco)
    VALUES (p_condominio_id, v_ident, NULLIF(v_bloco, ''))
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.vincular_unidade_morador(p_usuario_id uuid, p_unidade_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_usuario_id IS NULL OR p_unidade_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.unidade_moradores
    WHERE usuario_id = p_usuario_id AND unidade_id = p_unidade_id
  ) THEN
    INSERT INTO public.unidade_moradores (unidade_id, usuario_id)
    VALUES (p_unidade_id, p_usuario_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.criar_convite(
  p_condominio_id uuid,
  p_cargo text,
  p_email text DEFAULT NULL,
  p_unidade_texto text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_cargo public.tipo_cargo;
  v_unidade uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode gerar convite';
  END IF;
  IF p_cargo IS NULL OR p_cargo IN ('gestao_tecnica') THEN
    RAISE EXCEPTION 'Informe um cargo válido (não use Gestão Técnica neste convite)';
  END IF;
  v_cargo := p_cargo::public.tipo_cargo;
  v_unidade := NULL;

  IF v_cargo = 'morador' THEN
    v_unidade := public.resolver_unidade_texto(p_condominio_id, p_unidade_texto);
  END IF;

  INSERT INTO public.convites (condominio_id, cargo, email, unidade_id, unidade_texto, criado_por)
  VALUES (
    p_condominio_id,
    v_cargo,
    NULLIF(lower(trim(COALESCE(p_email, ''))), ''),
    v_unidade,
    CASE WHEN v_cargo = 'morador' THEN NULLIF(trim(COALESCE(p_unidade_texto, '')), '') ELSE NULL END,
    auth.uid()
  )
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.ver_convite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.convites;
  v_nome text;
  v_unidade text;
BEGIN
  SELECT * INTO v_row FROM public.convites WHERE token = p_token;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Convite não encontrado');
  END IF;
  SELECT nome INTO v_nome FROM public.condominios WHERE id = v_row.condominio_id;
  v_unidade := NULLIF(trim(COALESCE(v_row.unidade_texto, '')), '');
  IF v_unidade IS NULL AND v_row.unidade_id IS NOT NULL THEN
    SELECT CASE
      WHEN COALESCE(u.bloco, '') <> '' THEN 'Bloco ' || u.bloco || ' / ' || u.identificacao
      ELSE u.identificacao
    END
    INTO v_unidade
    FROM public.unidades u
    WHERE u.id = v_row.unidade_id;
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'condominio_id', v_row.condominio_id,
    'condominio', v_nome,
    'cargo', v_row.cargo,
    'email', v_row.email,
    'unidade_id', v_row.unidade_id,
    'unidade', v_unidade,
    'expirado', v_row.expires_at < NOW(),
    'usado', v_row.usado_em IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aceitar_convite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.convites;
  v_cargo uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO v_row FROM public.convites WHERE token = p_token FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado';
  END IF;
  IF v_row.usado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este convite já foi usado';
  END IF;
  IF v_row.expires_at < NOW() THEN
    RAISE EXCEPTION 'Este convite expirou';
  END IF;
  IF v_row.email IS NOT NULL AND lower(v_row.email) <> lower(COALESCE((SELECT email FROM public.usuarios WHERE id = auth.uid()), '')) THEN
    RAISE EXCEPTION 'Este convite é para outro e-mail';
  END IF;

  PERFORM public.garantir_perfil_usuario(auth.uid());

  v_cargo := public.cargo_id_por_tipo(v_row.cargo::text);
  IF v_cargo IS NULL THEN
    RAISE EXCEPTION 'Cargo do convite não encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuario_condominio
    WHERE usuario_id = auth.uid() AND condominio_id = v_row.condominio_id
  ) THEN
    INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
    VALUES (auth.uid(), v_row.condominio_id, v_cargo, TRUE);
  END IF;

  PERFORM public.vincular_unidade_morador(auth.uid(), v_row.unidade_id);

  UPDATE public.convites
  SET usado_em = NOW(), usado_por = auth.uid()
  WHERE id = v_row.id;

  RETURN v_row.condominio_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.aceitar_convite_cadastro(p_token text, p_usuario_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.convites;
  v_cargo uuid;
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário inválido';
  END IF;

  PERFORM public.garantir_perfil_usuario(p_usuario_id);

  SELECT * INTO v_row FROM public.convites WHERE token = p_token FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado';
  END IF;
  IF v_row.usado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este convite já foi usado';
  END IF;
  IF v_row.expires_at < NOW() THEN
    RAISE EXCEPTION 'Este convite expirou';
  END IF;

  v_cargo := public.cargo_id_por_tipo(v_row.cargo::text);
  IF v_cargo IS NULL THEN
    RAISE EXCEPTION 'Cargo do convite não encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuario_condominio
    WHERE usuario_id = p_usuario_id AND condominio_id = v_row.condominio_id
  ) THEN
    INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
    VALUES (p_usuario_id, v_row.condominio_id, v_cargo, TRUE);
  END IF;

  PERFORM public.vincular_unidade_morador(p_usuario_id, v_row.unidade_id);

  UPDATE public.convites
  SET usado_em = NOW(), usado_por = p_usuario_id
  WHERE id = v_row.id;

  RETURN v_row.condominio_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.vincular_usuario_ao_condominio(
  p_condominio_id uuid,
  p_cargo text,
  p_usuario_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_unidade_texto text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_cargo uuid;
  v_unidade uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode vincular usuários';
  END IF;
  IF p_cargo IS NULL OR p_cargo = 'gestao_tecnica' THEN
    RAISE EXCEPTION 'Informe um cargo válido';
  END IF;

  v_user := p_usuario_id;
  IF v_user IS NULL AND COALESCE(trim(p_email), '') <> '' THEN
    SELECT id INTO v_user FROM public.usuarios WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  END IF;
  IF v_user IS NULL AND COALESCE(trim(p_email), '') <> '' THEN
    SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado. Crie o login primeiro ou use o convite.';
  END IF;

  v_user := public.garantir_perfil_usuario(v_user);

  v_cargo := public.cargo_id_por_tipo(p_cargo);
  IF v_cargo IS NULL THEN
    RAISE EXCEPTION 'Cargo % não encontrado', p_cargo;
  END IF;

  IF p_cargo = 'morador' THEN
    v_unidade := public.resolver_unidade_texto(p_condominio_id, p_unidade_texto);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuario_condominio
    WHERE usuario_id = v_user AND condominio_id = p_condominio_id
  ) THEN
    INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
    VALUES (v_user, p_condominio_id, v_cargo, TRUE);
  END IF;

  IF p_cargo = 'morador' THEN
    PERFORM public.vincular_unidade_morador(v_user, v_unidade);
  END IF;

  RETURN v_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_convites(p_condominio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode listar convites';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x))
    FROM (
      SELECT
        c.id,
        c.token,
        c.cargo,
        c.email,
        c.created_at,
        c.expires_at,
        c.usado_em,
        c.unidade_id,
        COALESCE(
          NULLIF(trim(c.unidade_texto), ''),
          CASE
            WHEN COALESCE(u.bloco, '') <> '' THEN 'Bloco ' || u.bloco || ' / ' || u.identificacao
            ELSE u.identificacao
          END
        ) AS unidade
      FROM public.convites c
      LEFT JOIN public.unidades u ON u.id = c.unidade_id
      WHERE c.condominio_id = p_condominio_id
      ORDER BY c.created_at DESC
    ) x
  ), '[]'::jsonb);
END;
$$;

GRANT SELECT, INSERT, UPDATE ON public.convites TO authenticated;
GRANT EXECUTE ON FUNCTION public.cargo_id_por_tipo(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_unidade_morador(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_unidade_texto(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_convite(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ver_convite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_convite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_convite_cadastro(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_usuario_ao_condominio(uuid, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_convites(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.garantir_perfil_usuario(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_login_app(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marca_condominio(uuid) TO anon, authenticated;

ALTER TABLE public.condominios ADD COLUMN IF NOT EXISTS logo_path text;
ALTER TABLE public.imagens_condominio ADD COLUMN IF NOT EXISTS tipo text;

CREATE OR REPLACE FUNCTION public.marca_condominio(p_condominio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_nome text;
  v_logo text;
  v_capa text;
  v_visao text;
  v_login text;
BEGIN
  SELECT c.nome, NULLIF(c.logo_path, '')
  INTO v_nome, v_logo
  FROM public.condominios c
  WHERE c.id = p_condominio_id;

  v_logo := COALESCE(
    (
      SELECT a.storage_path
      FROM public.imagens_condominio i
      JOIN public.arquivos a ON a.id = i.arquivo_id
      WHERE i.condominio_id = p_condominio_id
        AND (i.tipo = 'logo' OR lower(i.titulo) = 'logo')
      ORDER BY i.id DESC
      LIMIT 1
    ),
    v_logo,
    (
      SELECT o.name
      FROM storage.objects o
      WHERE o.bucket_id = 'condominios'
        AND (
          o.name LIKE p_condominio_id::text || '/marca/logo.%'
          OR o.name ILIKE p_condominio_id::text || '/marca/%logo%'
        )
      ORDER BY o.created_at DESC
      LIMIT 1
    )
  );

  v_capa := COALESCE(
    (
      SELECT a.storage_path
      FROM public.imagens_condominio i
      JOIN public.arquivos a ON a.id = i.arquivo_id
      WHERE i.condominio_id = p_condominio_id
        AND (i.tipo = 'capa' OR lower(i.titulo) IN ('imagem capa', 'capa'))
      ORDER BY i.id DESC
      LIMIT 1
    ),
    (
      SELECT o.name
      FROM storage.objects o
      WHERE o.bucket_id = 'condominios'
        AND o.name LIKE p_condominio_id::text || '/marca/capa.%'
      ORDER BY o.created_at DESC
      LIMIT 1
    )
  );

  v_visao := COALESCE(
    (
      SELECT a.storage_path
      FROM public.imagens_condominio i
      JOIN public.arquivos a ON a.id = i.arquivo_id
      WHERE i.condominio_id = p_condominio_id
        AND (i.tipo = 'visao_geral' OR lower(i.titulo) IN ('imagem visão geral', 'imagem visao geral'))
      ORDER BY i.id DESC
      LIMIT 1
    ),
    (
      SELECT o.name
      FROM storage.objects o
      WHERE o.bucket_id = 'condominios'
        AND o.name LIKE p_condominio_id::text || '/marca/visao_geral.%'
      ORDER BY o.created_at DESC
      LIMIT 1
    )
  );

  v_login := COALESCE(
    (
      SELECT a.storage_path
      FROM public.imagens_condominio i
      JOIN public.arquivos a ON a.id = i.arquivo_id
      WHERE i.condominio_id = p_condominio_id
        AND (i.tipo = 'login' OR lower(i.titulo) IN ('imagem login', 'login'))
      ORDER BY i.id DESC
      LIMIT 1
    ),
    (
      SELECT o.name
      FROM storage.objects o
      WHERE o.bucket_id = 'condominios'
        AND o.name LIKE p_condominio_id::text || '/marca/login.%'
      ORDER BY o.created_at DESC
      LIMIT 1
    )
  );

  RETURN jsonb_build_object(
    'nome', v_nome,
    'logo', v_logo,
    'capa', v_capa,
    'visao_geral', v_visao,
    'login', v_login
  );
END;
$$;

DROP POLICY IF EXISTS storage_marca_anon ON storage.objects;
CREATE POLICY storage_marca_anon ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'condominios'
    AND split_part(name, '/', 2) = 'marca'
  );

NOTIFY pgrst, 'reload schema';
