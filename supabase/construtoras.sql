-- Construtora como organização: cadastro, vínculo no condomínio, login próprio e portal.
-- Rode o ARQUIVO INTEIRO no SQL Editor.

CREATE TABLE IF NOT EXISTS public.construtoras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  razao_social text,
  nome_fantasia text,
  cnpj text,
  email text,
  descricao text,
  logo_path text,
  dominio text,
  ativo boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.construtoras
  ADD COLUMN IF NOT EXISTS razao_social text,
  ADD COLUMN IF NOT EXISTS nome_fantasia text;

UPDATE public.construtoras
SET
  nome_fantasia = COALESCE(NULLIF(btrim(nome_fantasia), ''), nome),
  razao_social = COALESCE(NULLIF(btrim(razao_social), ''), nome)
WHERE nome IS NOT NULL;

ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS construtora_id uuid REFERENCES public.construtoras(id) ON DELETE SET NULL;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS construtora_id uuid REFERENCES public.construtoras(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.usuario_construtora_escopo (
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, condominio_id)
);

CREATE INDEX IF NOT EXISTS condominios_construtora_id_idx
  ON public.condominios (construtora_id);

CREATE INDEX IF NOT EXISTS usuarios_construtora_id_idx
  ON public.usuarios (construtora_id);

CREATE UNIQUE INDEX IF NOT EXISTS construtoras_dominio_unique
  ON public.construtoras (lower(dominio))
  WHERE dominio IS NOT NULL AND btrim(dominio) <> '';

ALTER TABLE public.construtoras ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.usuario_construtora_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.construtora_id
  FROM public.usuarios u
  WHERE u.id = auth.uid()
    AND COALESCE(u.ativo, TRUE) IS TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_is_construtora_org()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.usuario_construtora_id() IS NOT NULL
    AND COALESCE((SELECT u.gestao_tecnica FROM public.usuarios u WHERE u.id = auth.uid()), FALSE) IS FALSE
    AND COALESCE((SELECT u.admin_sistema FROM public.usuarios u WHERE u.id = auth.uid()), FALSE) IS FALSE;
$$;

CREATE OR REPLACE FUNCTION public.tem_acesso_construtora(p_construtora_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_construtora_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      public.user_is_gestao_tecnica()
      OR public.usuario_construtora_id() = p_construtora_id
      OR EXISTS (
        SELECT 1
        FROM public.usuario_condominio uc
        JOIN public.condominios d ON d.id = uc.condominio_id
        LEFT JOIN public.cargos cg ON cg.id = uc.cargo_id
        WHERE uc.usuario_id = auth.uid()
          AND COALESCE(uc.ativo, TRUE) IS TRUE
          AND d.construtora_id = p_construtora_id
          AND cg.tipo = 'construtora'::public.tipo_cargo
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.user_is_construtora_org_do_condominio(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    JOIN public.condominios d ON d.construtora_id = u.construtora_id
    WHERE u.id = auth.uid()
      AND COALESCE(u.ativo, TRUE) IS TRUE
      AND u.construtora_id IS NOT NULL
      AND d.id = cid
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.usuario_construtora_escopo e
          WHERE e.usuario_id = u.id
        )
        OR EXISTS (
          SELECT 1 FROM public.usuario_construtora_escopo e
          WHERE e.usuario_id = u.id
            AND e.condominio_id = cid
        )
      )
  );
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
  )
  OR public.user_is_construtora_org_do_condominio(cid);
$$;

DROP FUNCTION IF EXISTS public.listar_condominios_da_minha_construtora();

CREATE FUNCTION public.listar_condominios_da_minha_construtora()
RETURNS TABLE (
  id uuid,
  nome text,
  logo_path text,
  ativo boolean,
  construtora_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := public.usuario_construtora_id();
BEGIN
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.nome::text,
    d.logo_path::text,
    COALESCE(d.ativo, TRUE)::boolean,
    d.construtora_id
  FROM public.condominios d
  WHERE d.construtora_id = v_id
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.usuario_construtora_escopo e
        WHERE e.usuario_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.usuario_construtora_escopo e
        WHERE e.usuario_id = auth.uid()
          AND e.condominio_id = d.id
      )
    )
  ORDER BY d.nome;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_construtora(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_cargo_tipo(cid) = 'construtora'::public.tipo_cargo
    OR public.user_is_construtora_org_do_condominio(cid);
$$;

DROP POLICY IF EXISTS construtoras_select ON public.construtoras;
DROP POLICY IF EXISTS construtoras_write ON public.construtoras;
CREATE POLICY construtoras_select ON public.construtoras
  FOR SELECT TO authenticated
  USING (
    public.user_is_gestao_tecnica()
    OR id = public.usuario_construtora_id()
  );
CREATE POLICY construtoras_write ON public.construtoras
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica())
  WITH CHECK (public.user_is_gestao_tecnica());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.construtoras TO authenticated;

CREATE OR REPLACE FUNCTION public.dominio_em_uso(p_dominio text, p_exceto_condo uuid DEFAULT NULL, p_exceto_construtora uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.normalizar_dominio(p_dominio) IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.condominios c
        WHERE public.normalizar_dominio(c.dominio) = public.normalizar_dominio(p_dominio)
          AND (p_exceto_condo IS NULL OR c.id <> p_exceto_condo)
      )
      OR EXISTS (
        SELECT 1
        FROM public.construtoras x
        WHERE public.normalizar_dominio(x.dominio) = public.normalizar_dominio(p_dominio)
          AND (p_exceto_construtora IS NULL OR x.id <> p_exceto_construtora)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.salvar_dominio_condominio(p_condominio_id uuid, p_dominio text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dom text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode salvar o domínio';
  END IF;
  IF p_condominio_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.condominios WHERE id = p_condominio_id) THEN
    RAISE EXCEPTION 'Condomínio não encontrado';
  END IF;

  v_dom := public.normalizar_dominio(p_dominio);
  IF public.dominio_em_uso(v_dom, p_condominio_id, NULL) THEN
    RAISE EXCEPTION 'Este domínio já está em uso';
  END IF;

  UPDATE public.condominios
  SET dominio = v_dom
  WHERE id = p_condominio_id;

  RETURN v_dom;
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_dominio_construtora(p_construtora_id uuid, p_dominio text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dom text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode salvar o domínio';
  END IF;
  IF p_construtora_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.construtoras WHERE id = p_construtora_id) THEN
    RAISE EXCEPTION 'Construtora não encontrada';
  END IF;

  v_dom := public.normalizar_dominio(p_dominio);
  IF public.dominio_em_uso(v_dom, NULL, p_construtora_id) THEN
    RAISE EXCEPTION 'Este domínio já está em uso';
  END IF;

  UPDATE public.construtoras
  SET dominio = v_dom,
      updated_at = NOW()
  WHERE id = p_construtora_id;

  RETURN v_dom;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolver_login_portal(p_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_slug text;
  v_host text;
BEGIN
  p_ref := trim(COALESCE(p_ref, ''));
  IF p_ref = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_id := p_ref::uuid;
    IF EXISTS (SELECT 1 FROM public.construtoras WHERE id = v_id) THEN
      RETURN jsonb_build_object('tipo', 'construtora', 'id', v_id);
    END IF;
    IF EXISTS (SELECT 1 FROM public.condominios WHERE id = v_id) THEN
      RETURN jsonb_build_object('tipo', 'condominio', 'id', v_id);
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    v_id := NULL;
  END;

  v_host := public.normalizar_dominio(p_ref);
  IF v_host IS NOT NULL THEN
    SELECT x.id INTO v_id
    FROM public.construtoras x
    WHERE public.normalizar_dominio(x.dominio) = v_host
    ORDER BY x.nome ASC, x.id ASC
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('tipo', 'construtora', 'id', v_id);
    END IF;

    SELECT c.id INTO v_id
    FROM public.condominios c
    WHERE public.normalizar_dominio(c.dominio) = v_host
    ORDER BY c.nome ASC, c.id ASC
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('tipo', 'condominio', 'id', v_id);
    END IF;
  END IF;

  v_slug := public.slug_condominio(p_ref);

  SELECT x.id INTO v_id
  FROM public.construtoras x
  WHERE public.slug_condominio(x.nome) = v_slug
     OR public.slug_condominio(x.nome_fantasia) = v_slug
     OR public.slug_condominio(x.razao_social) = v_slug
     OR lower(trim(x.nome)) = lower(p_ref)
     OR lower(trim(COALESCE(x.nome_fantasia, ''))) = lower(p_ref)
     OR lower(trim(COALESCE(x.razao_social, ''))) = lower(p_ref)
  ORDER BY x.nome ASC, x.id ASC
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('tipo', 'construtora', 'id', v_id);
  END IF;

  SELECT c.id INTO v_id
  FROM public.condominios c
  WHERE public.slug_condominio(c.nome) = v_slug
     OR lower(trim(c.nome)) = lower(p_ref)
  ORDER BY c.nome ASC, c.id ASC
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('tipo', 'condominio', 'id', v_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.marca_construtora(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', x.id,
    'nome', COALESCE(NULLIF(btrim(x.nome_fantasia), ''), x.nome, x.razao_social),
    'nome_fantasia', x.nome_fantasia,
    'razao_social', x.razao_social,
    'logo', x.logo_path,
    'dominio', x.dominio
  )
  FROM public.construtoras x
  WHERE x.id = p_id;
$$;

DROP POLICY IF EXISTS storage_condo_select ON storage.objects;
DROP POLICY IF EXISTS storage_condo_insert ON storage.objects;
DROP POLICY IF EXISTS storage_condo_update ON storage.objects;
DROP POLICY IF EXISTS storage_condo_delete ON storage.objects;
DROP POLICY IF EXISTS storage_marca_anon ON storage.objects;

CREATE POLICY storage_marca_anon ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'condominios'
    AND split_part(name, '/', 2) = 'marca'
  );

CREATE POLICY storage_condo_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'condominios'
    AND (
      split_part(name, '/', 2) = 'marca'
      OR public.user_is_gestao_tecnica()
      OR (
        split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
      )
      OR (
        public.user_is_construtora_org()
        AND EXISTS (
          SELECT 1
          FROM public.construtoras x
          JOIN public.usuarios u ON u.construtora_id = x.id
          WHERE u.id = auth.uid()
            AND x.id::text = split_part(name, '/', 1)
        )
      )
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

CREATE OR REPLACE FUNCTION public.criar_usuario_construtora(
  p_construtora_id uuid,
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
  created_at timestamptz
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
  SELECT u.id, u.nome, u.email, u.ativo, u.updated_at
  FROM public.usuarios u
  WHERE u.construtora_id = p_construtora_id
  ORDER BY u.nome, u.email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_condominios_da_minha_construtora() TO authenticated;
GRANT EXECUTE ON FUNCTION public.usuario_construtora_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tem_acesso_construtora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_construtora_org() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_construtora_org_do_condominio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_belongs_to_condominio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_construtora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dominio_em_uso(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_dominio_condominio(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_dominio_construtora(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_login_portal(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marca_construtora(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.criar_usuario_construtora(uuid, text, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_construtora(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
