-- Lista usuários do condomínio (nome + unidade) para Gestão Técnica / staff.
-- Rode no SQL Editor do Supabase (arquivo inteiro).

-- Garante que o nome informado seja gravado/atualizado no perfil
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
        -- Se veio nome explícito, sobrescreve; senão preserva o atual
        nome = CASE
          WHEN NULLIF(trim(COALESCE(p_nome, '')), '') IS NOT NULL THEN trim(p_nome)
          ELSE COALESCE(NULLIF(trim(public.usuarios.nome), ''), EXCLUDED.nome)
        END,
        ativo = TRUE,
        updated_at = NOW();

  -- Mantém metadata do Auth alinhada
  UPDATE auth.users
  SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('nome', (
        SELECT nome FROM public.usuarios WHERE id = p_usuario_id
      ))
  WHERE id = p_usuario_id;

  RETURN p_usuario_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.vincular_usuario_ao_condominio(
  p_condominio_id uuid,
  p_cargo text,
  p_usuario_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_unidade_texto text DEFAULT NULL,
  p_nome text DEFAULT NULL
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

  v_user := public.garantir_perfil_usuario(v_user, p_nome);

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
  ELSE
    UPDATE public.usuario_condominio
    SET cargo_id = v_cargo, ativo = TRUE
    WHERE usuario_id = v_user AND condominio_id = p_condominio_id;
  END IF;

  IF p_cargo = 'morador' AND v_unidade IS NOT NULL THEN
    PERFORM public.vincular_unidade_morador(v_user, v_unidade);
  END IF;

  RETURN v_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_usuarios_condominio(p_condominio_id uuid)
RETURNS TABLE (
  id uuid,
  usuario_id uuid,
  nome text,
  email text,
  telefone text,
  unidade text,
  cargo text,
  cargo_tipo text,
  ativo boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT (
    public.user_is_gestao_tecnica()
    OR public.user_is_staff(p_condominio_id)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para listar usuários deste condomínio';
  END IF;

  -- Preenche nome/e-mail vazios a partir do Auth (dados antigos)
  UPDATE public.usuarios u
  SET nome = COALESCE(
        NULLIF(trim(u.nome), ''),
        NULLIF(trim(au.raw_user_meta_data->>'nome'), ''),
        NULLIF(trim(au.raw_user_meta_data->>'name'), ''),
        split_part(au.email, '@', 1)
      ),
      email = COALESCE(NULLIF(trim(u.email), ''), lower(au.email)),
      updated_at = NOW()
  FROM auth.users au
  WHERE au.id = u.id
    AND u.id IN (
      SELECT uc2.usuario_id
      FROM public.usuario_condominio uc2
      WHERE uc2.condominio_id = p_condominio_id
    )
    AND (
      NULLIF(trim(u.nome), '') IS NULL
      OR lower(trim(u.nome)) = lower(split_part(COALESCE(u.email, au.email), '@', 1))
    );

  -- Subquery com aliases distintos evita conflito com colunas OUT do RETURNS TABLE
  RETURN QUERY
  SELECT
    q.link_id::uuid,
    q.uid::uuid,
    q.nome_out::text,
    q.email_out::text,
    q.telefone_out::text,
    q.unidade_out::text,
    q.cargo_out::text,
    q.cargo_tipo_out::text,
    q.ativo_out::boolean
  FROM (
    SELECT
      uc.id AS link_id,
      uc.usuario_id AS uid,
      COALESCE(
        NULLIF(trim(u.nome), ''),
        NULLIF(trim(au.raw_user_meta_data->>'nome'), ''),
        NULLIF(trim(au.raw_user_meta_data->>'name'), ''),
        NULLIF(split_part(COALESCE(u.email, au.email, ''), '@', 1), ''),
        'Usuário'
      ) AS nome_out,
      COALESCE(u.email, au.email) AS email_out,
      u.telefone AS telefone_out,
      COALESCE(
        (
          SELECT string_agg(x.label, ' · ' ORDER BY x.label)
          FROM (
            SELECT DISTINCT
              (
                CASE
                  WHEN COALESCE(un.bloco, '') <> '' THEN 'Bloco ' || un.bloco || ' / ' || un.identificacao
                  ELSE un.identificacao
                END
              )::text AS label
            FROM public.unidade_moradores um
            JOIN public.unidades un ON un.id = um.unidade_id
            WHERE um.usuario_id = uc.usuario_id
              AND un.condominio_id = p_condominio_id
          ) x
        ),
        'Sem unidade'
      ) AS unidade_out,
      COALESCE(c.nome::text, c.tipo::text, '') AS cargo_out,
      c.tipo::text AS cargo_tipo_out,
      (COALESCE(u.ativo, TRUE) AND COALESCE(uc.ativo, TRUE)) AS ativo_out
    FROM public.usuario_condominio uc
    LEFT JOIN public.usuarios u ON u.id = uc.usuario_id
    LEFT JOIN auth.users au ON au.id = uc.usuario_id
    LEFT JOIN public.cargos c ON c.id = uc.cargo_id
    WHERE uc.condominio_id = p_condominio_id
  ) q
  ORDER BY q.nome_out ASC NULLS LAST;
END;
$$;

-- Remove overload antigo (5 args) para o PostgREST não ficar ambíguo
DROP FUNCTION IF EXISTS public.vincular_usuario_ao_condominio(uuid, text, uuid, text, text);

GRANT EXECUTE ON FUNCTION public.garantir_perfil_usuario(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_usuario_ao_condominio(uuid, text, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_condominio(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
