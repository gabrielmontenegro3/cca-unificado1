-- Foto de perfil, convite da construtora (como morador) e escopo de condomínios.
-- Rode o ARQUIVO INTEIRO no SQL Editor, depois de construtoras.sql.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS foto_path text;

ALTER TABLE public.convites
  ALTER COLUMN condominio_id DROP NOT NULL;

ALTER TABLE public.convites
  ADD COLUMN IF NOT EXISTS construtora_id uuid REFERENCES public.construtoras(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS escopo_condominio_ids uuid[],
  ADD COLUMN IF NOT EXISTS gestao_tecnica boolean NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.usuario_construtora_escopo (
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  condominio_id uuid NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, condominio_id)
);

ALTER TABLE public.usuario_construtora_escopo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uce_select ON public.usuario_construtora_escopo;
DROP POLICY IF EXISTS uce_write ON public.usuario_construtora_escopo;
CREATE POLICY uce_select ON public.usuario_construtora_escopo
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid() OR public.user_is_gestao_tecnica());
CREATE POLICY uce_write ON public.usuario_construtora_escopo
  FOR ALL TO authenticated
  USING (public.user_is_gestao_tecnica())
  WITH CHECK (public.user_is_gestao_tecnica());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.usuario_construtora_escopo TO authenticated;

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
      AND u.ativo IS TRUE
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

CREATE OR REPLACE FUNCTION public.aplicar_escopo_construtora(
  p_usuario_id uuid,
  p_construtora_id uuid,
  p_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_usuario_id IS NULL OR p_construtora_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.usuario_construtora_escopo WHERE usuario_id = p_usuario_id;

  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.usuario_construtora_escopo (usuario_id, condominio_id)
  SELECT p_usuario_id, d.id
  FROM public.condominios d
  WHERE d.id = ANY (p_ids)
    AND d.construtora_id = p_construtora_id
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_foto_usuario(p_usuario_id uuid, p_foto_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário inválido';
  END IF;
  IF auth.uid() IS DISTINCT FROM p_usuario_id
     AND NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Sem permissão para salvar esta foto';
  END IF;
  UPDATE public.usuarios
  SET foto_path = NULLIF(trim(COALESCE(p_foto_path, '')), ''),
      updated_at = NOW()
  WHERE id = p_usuario_id;
END;
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
      OR split_part(name, '/', 2) = 'perfil'
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
      OR (
        split_part(name, '/', 2) = 'perfil'
        AND split_part(name, '/', 1) = auth.uid()::text
      )
      OR (
        split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
      )
    )
  );

CREATE POLICY storage_condo_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'condominios'
    AND (
      public.user_is_gestao_tecnica()
      OR (
        split_part(name, '/', 2) = 'perfil'
        AND split_part(name, '/', 1) = auth.uid()::text
      )
      OR (
        split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
      )
    )
  );

CREATE POLICY storage_condo_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'condominios'
    AND (
      public.user_is_gestao_tecnica()
      OR owner = auth.uid()
      OR (
        split_part(name, '/', 2) = 'perfil'
        AND split_part(name, '/', 1) = auth.uid()::text
      )
      OR (
        split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.user_belongs_to_condominio((split_part(name, '/', 1))::uuid)
      )
    )
  );

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

DROP FUNCTION IF EXISTS public.listar_usuarios_gestao_tecnica();

CREATE OR REPLACE FUNCTION public.listar_usuarios_gestao_tecnica()
RETURNS TABLE (
  id uuid,
  nome text,
  email text,
  ativo boolean,
  created_at timestamptz,
  foto_path text
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
  SELECT u.id, u.nome, u.email, u.ativo, u.updated_at, u.foto_path
  FROM public.usuarios u
  WHERE u.gestao_tecnica IS TRUE
    AND COALESCE(u.admin_sistema, FALSE) IS FALSE
  ORDER BY u.nome, u.email;
END;
$$;

CREATE OR REPLACE FUNCTION public.criar_convite_construtora(
  p_construtora_id uuid,
  p_email text DEFAULT NULL,
  p_escopo_condominio_ids uuid[] DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.user_is_gestao_tecnica() THEN
    RAISE EXCEPTION 'Somente a Gestão Técnica pode gerar convite';
  END IF;
  IF p_construtora_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.construtoras WHERE id = p_construtora_id) THEN
    RAISE EXCEPTION 'Construtora não encontrada';
  END IF;

  IF p_escopo_condominio_ids IS NULL OR cardinality(p_escopo_condominio_ids) = 0 THEN
    v_ids := NULL;
  ELSE
    SELECT coalesce(array_agg(d.id), ARRAY[]::uuid[])
    INTO v_ids
    FROM public.condominios d
    WHERE d.id = ANY (p_escopo_condominio_ids)
      AND d.construtora_id = p_construtora_id;
  END IF;

  INSERT INTO public.convites (
    condominio_id, cargo, email, construtora_id, escopo_condominio_ids, criado_por
  ) VALUES (
    NULL,
    'construtora',
    NULLIF(lower(trim(COALESCE(p_email, ''))), ''),
    p_construtora_id,
    v_ids,
    auth.uid()
  )
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_convites_construtora(p_construtora_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_is_gestao_tecnica() THEN
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
        c.construtora_id,
        c.escopo_condominio_ids,
        (
          SELECT string_agg(d.nome, ', ' ORDER BY d.nome)
          FROM public.condominios d
          WHERE c.escopo_condominio_ids IS NOT NULL
            AND d.id = ANY (c.escopo_condominio_ids)
        ) AS condominios
      FROM public.convites c
      WHERE c.construtora_id = p_construtora_id
      ORDER BY c.created_at DESC
      LIMIT 40
    ) x
  ), '[]'::jsonb);
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
  v_construtora text;
BEGIN
  SELECT * INTO v_row FROM public.convites WHERE token = p_token;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Convite não encontrado');
  END IF;
  IF v_row.condominio_id IS NOT NULL THEN
    SELECT nome INTO v_nome FROM public.condominios WHERE id = v_row.condominio_id;
  END IF;
  IF v_row.construtora_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(nome_fantasia), ''), nome, razao_social)
    INTO v_construtora
    FROM public.construtoras
    WHERE id = v_row.construtora_id;
  END IF;
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
    'construtora_id', v_row.construtora_id,
    'construtora', v_construtora,
    'escopo_condominio_ids', v_row.escopo_condominio_ids,
    'gestao_tecnica', v_row.gestao_tecnica,
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

  IF COALESCE(v_row.gestao_tecnica, FALSE) THEN
    UPDATE public.usuarios
    SET gestao_tecnica = TRUE, updated_at = NOW()
    WHERE id = auth.uid();
    PERFORM public.vincular_gestao_a_todos_condominios(auth.uid());
  ELSIF v_row.construtora_id IS NOT NULL THEN
    UPDATE public.usuarios
    SET construtora_id = v_row.construtora_id, updated_at = NOW()
    WHERE id = auth.uid();
    PERFORM public.aplicar_escopo_construtora(auth.uid(), v_row.construtora_id, v_row.escopo_condominio_ids);
  ELSE
    v_cargo := public.cargo_id_por_tipo(v_row.cargo::text);
    IF v_cargo IS NULL THEN
      RAISE EXCEPTION 'Cargo do convite não encontrado';
    END IF;
    IF v_row.condominio_id IS NULL THEN
      RAISE EXCEPTION 'Convite sem condomínio';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.usuario_condominio
      WHERE usuario_id = auth.uid() AND condominio_id = v_row.condominio_id
    ) THEN
      INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
      VALUES (auth.uid(), v_row.condominio_id, v_cargo, TRUE);
    END IF;
    PERFORM public.vincular_unidade_morador(auth.uid(), v_row.unidade_id);
  END IF;

  UPDATE public.convites
  SET usado_em = NOW(), usado_por = auth.uid()
  WHERE id = v_row.id;

  RETURN COALESCE(v_row.condominio_id, v_row.construtora_id);
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

  IF COALESCE(v_row.gestao_tecnica, FALSE) THEN
    UPDATE public.usuarios
    SET gestao_tecnica = TRUE, updated_at = NOW()
    WHERE id = p_usuario_id;
    PERFORM public.vincular_gestao_a_todos_condominios(p_usuario_id);
  ELSIF v_row.construtora_id IS NOT NULL THEN
    UPDATE public.usuarios
    SET construtora_id = v_row.construtora_id, updated_at = NOW()
    WHERE id = p_usuario_id;
    PERFORM public.aplicar_escopo_construtora(p_usuario_id, v_row.construtora_id, v_row.escopo_condominio_ids);
  ELSE
    v_cargo := public.cargo_id_por_tipo(v_row.cargo::text);
    IF v_cargo IS NULL THEN
      RAISE EXCEPTION 'Cargo do convite não encontrado';
    END IF;
    IF v_row.condominio_id IS NULL THEN
      RAISE EXCEPTION 'Convite sem condomínio';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.usuario_condominio
      WHERE usuario_id = p_usuario_id AND condominio_id = v_row.condominio_id
    ) THEN
      INSERT INTO public.usuario_condominio (usuario_id, condominio_id, cargo_id, ativo)
      VALUES (p_usuario_id, v_row.condominio_id, v_cargo, TRUE);
    END IF;
    PERFORM public.vincular_unidade_morador(p_usuario_id, v_row.unidade_id);
  END IF;

  UPDATE public.convites
  SET usado_em = NOW(), usado_por = p_usuario_id
  WHERE id = v_row.id;

  RETURN COALESCE(v_row.condominio_id, v_row.construtora_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_is_construtora_org_do_condominio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_escopo_construtora(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_foto_usuario(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_usuario_construtora(uuid, text, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_construtora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_gestao_tecnica() TO authenticated;
CREATE OR REPLACE FUNCTION public.criar_convite_gestao_tecnica(p_email text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.user_is_admin_sistema() THEN
    RAISE EXCEPTION 'Somente o Administrador do sistema pode convidar Gestão Técnica';
  END IF;

  INSERT INTO public.convites (
    condominio_id, cargo, email, gestao_tecnica, criado_por
  ) VALUES (
    NULL,
    'gestao_tecnica',
    NULLIF(lower(trim(COALESCE(p_email, ''))), ''),
    TRUE,
    auth.uid()
  )
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_convites_gestao_tecnica()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_is_admin_sistema() THEN
    RAISE EXCEPTION 'Somente o Administrador do sistema pode listar convites da Gestão Técnica';
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
        c.gestao_tecnica
      FROM public.convites c
      WHERE c.gestao_tecnica IS TRUE
      ORDER BY c.created_at DESC
      LIMIT 40
    ) x
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_convite_construtora(uuid, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_convites_construtora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_convite_gestao_tecnica(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_convites_gestao_tecnica() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ver_convite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_convite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_convite_cadastro(text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
