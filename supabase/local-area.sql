-- Área do local: privativa (morador) ou comum (administração do condomínio).
-- Rode o ARQUIVO INTEIRO no SQL Editor.

ALTER TABLE public.locais
  ADD COLUMN IF NOT EXISTS area text;

UPDATE public.locais
SET area = CASE
  WHEN tipo::text = 'unidade' THEN 'privativa'
  ELSE 'comum'
END
WHERE area IS NULL OR btrim(area) = '';

ALTER TABLE public.locais
  ALTER COLUMN area SET DEFAULT 'comum';

UPDATE public.locais SET area = 'comum' WHERE area IS NULL OR btrim(area) = '';

ALTER TABLE public.locais
  ALTER COLUMN area SET NOT NULL;

ALTER TABLE public.locais DROP CONSTRAINT IF EXISTS locais_area_check;
ALTER TABLE public.locais
  ADD CONSTRAINT locais_area_check CHECK (area IN ('privativa', 'comum'));

CREATE OR REPLACE FUNCTION public.user_catalog_area(cid uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cargo public.tipo_cargo;
  v_org boolean := FALSE;
BEGIN
  IF cid IS NULL OR auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  IF public.user_is_gestao_tecnica() OR public.user_is_gestao(cid) THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_org := public.user_is_construtora(cid);
  EXCEPTION
    WHEN undefined_function THEN
      v_org := FALSE;
  END;
  IF v_org THEN
    RETURN NULL;
  END IF;

  v_cargo := public.user_cargo_tipo(cid);
  IF v_cargo IN (
    'administrador'::public.tipo_cargo,
    'gestao_tecnica'::public.tipo_cargo,
    'construtora'::public.tipo_cargo
  ) THEN
    RETURN NULL;
  END IF;
  IF v_cargo = 'administracao'::public.tipo_cargo THEN
    RETURN 'comum';
  END IF;
  RETURN 'privativa';
END;
$$;

CREATE OR REPLACE FUNCTION public.local_visivel_para_usuario(p_local_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.locais l
    WHERE l.id = p_local_id
      AND public.user_belongs_to_condominio(l.condominio_id)
      AND (
        public.user_catalog_area(l.condominio_id) IS NULL
        OR COALESCE(l.area, 'comum') = public.user_catalog_area(l.condominio_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.material_visivel_para_usuario(p_material_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.materiais m
    WHERE m.id = p_material_id
      AND public.user_belongs_to_condominio(m.condominio_id)
      AND (
        public.user_catalog_area(m.condominio_id) IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.material_locais ml
          JOIN public.locais l ON l.id = ml.local_id
          WHERE ml.material_id = m.id
            AND COALESCE(l.area, 'comum') = public.user_catalog_area(m.condominio_id)
        )
      )
  );
$$;

DROP POLICY IF EXISTS loc_select ON public.locais;
CREATE POLICY loc_select ON public.locais
  FOR SELECT TO authenticated
  USING (public.local_visivel_para_usuario(id));

DROP POLICY IF EXISTS mat_select ON public.materiais;
CREATE POLICY mat_select ON public.materiais
  FOR SELECT TO authenticated
  USING (public.material_visivel_para_usuario(id));

DROP POLICY IF EXISTS ml_select ON public.material_locais;
CREATE POLICY ml_select ON public.material_locais
  FOR SELECT TO authenticated
  USING (
    public.local_visivel_para_usuario(local_id)
    AND public.material_visivel_para_usuario(material_id)
  );

GRANT EXECUTE ON FUNCTION public.user_catalog_area(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.local_visivel_para_usuario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.material_visivel_para_usuario(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
