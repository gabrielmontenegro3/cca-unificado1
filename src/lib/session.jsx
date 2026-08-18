import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase';
import { loadBranding, rememberBrandCondo } from './branding';
import { CARGO_LABEL } from './permissions';

const SessionContext = createContext(null);
const STORAGE_KEY = 'cca.condominio';

function metaFlag(value) {
  return value === true || value === 'true' || value === 'gestao_tecnica';
}

function normTipo(value) {
  return String(value || '').toLowerCase().trim();
}

function asCargo(raw) {
  if (!raw) return null;
  const item = Array.isArray(raw) ? raw[0] : raw;
  if (!item || typeof item !== 'object') return null;
  const tipo = normTipo(item.tipo);
  if (!tipo) return null;
  return { ...item, tipo, nome: item.nome || CARGO_LABEL[tipo] || tipo };
}

function cargoFrom(row) {
  return asCargo(row?.cargos) || asCargo(row?.cargo);
}

export function detectGestaoTecnica(profile, authUser, links) {
  if (profile?.gestao_tecnica) return true;
  if (metaFlag(authUser?.user_metadata?.gestao_tecnica) || metaFlag(authUser?.app_metadata?.gestao_tecnica)) return true;
  if (authUser?.app_metadata?.role === 'gestao_tecnica') return true;
  return (links || []).some((item) => cargoFrom(item)?.tipo === 'gestao_tecnica');
}

function asGestaoMemberships(condos) {
  return (condos || []).map((condo) => ({
    id: `gt-${condo.id}`,
    condominio_id: condo.id,
    ativo: true,
    cargos: { id: 'gestao_tecnica', nome: 'Gestão Técnica', tipo: 'gestao_tecnica' },
    condominios: condo,
  }));
}

async function attachCargos(rows) {
  const list = rows || [];
  const missing = list.filter((row) => row.cargo_id && !cargoFrom(row)?.tipo);
  if (!missing.length) {
    return list.map((row) => ({ ...row, cargos: cargoFrom(row) }));
  }
  const ids = [...new Set(missing.map((row) => row.cargo_id))];
  const { data: cargos } = await supabase.from('cargos').select('id, nome, tipo').in('id', ids);
  const byId = Object.fromEntries((cargos || []).map((c) => [c.id, asCargo(c)]).filter(([, c]) => c));
  return list.map((row) => ({
    ...row,
    cargos: cargoFrom(row) || byId[row.cargo_id] || null,
  }));
}

async function inferCargoViaRpc(rows) {
  const list = rows || [];
  const missing = list.filter((row) => row.condominio_id && !cargoFrom(row)?.tipo);
  if (!missing.length) return list;
  const found = await Promise.all(missing.map(async (row) => {
    const { data } = await supabase.rpc('user_cargo_tipo', { cid: row.condominio_id });
    const tipo = normTipo(data);
    return [row.condominio_id, tipo];
  }));
  const byCondo = Object.fromEntries(found.filter(([, tipo]) => tipo));
  return list.map((row) => {
    const current = cargoFrom(row);
    if (current?.tipo) return { ...row, cargos: current };
    const tipo = byCondo[row.condominio_id];
    if (!tipo) return row;
    return { ...row, cargos: { tipo, nome: CARGO_LABEL[tipo] || tipo } };
  });
}

async function inferMoradorByUnidade(userId, rows) {
  const list = rows || [];
  const missing = list.filter((row) => row.condominio_id && !cargoFrom(row)?.tipo);
  if (!missing.length) return list;
  const { data } = await supabase
    .from('unidade_moradores')
    .select('unidades(condominio_id)')
    .eq('usuario_id', userId);
  const condoIds = new Set((data || []).map((row) => row.unidades?.condominio_id).filter(Boolean));
  return list.map((row) => {
    const current = cargoFrom(row);
    if (current?.tipo) return { ...row, cargos: current };
    if (!condoIds.has(row.condominio_id)) return row;
    return { ...row, cargos: { tipo: 'morador', nome: 'Morador' } };
  });
}

async function loadMemberships(userId, isGestaoTecnica) {
  if (isGestaoTecnica) {
    const { data, error } = await supabase
      .from('condominios')
      .select('id, nome, logo_path, ativo')
      .order('nome');
    return { links: asGestaoMemberships(data), error };
  }
  let { data, error } = await supabase
    .from('usuario_condominio')
    .select('id, ativo, condominio_id, cargo_id, cargos(id, nome, tipo), condominios(id, nome, logo_path, ativo)')
    .eq('usuario_id', userId)
    .eq('ativo', true);
  if (error) {
    const plain = await supabase
      .from('usuario_condominio')
      .select('id, ativo, condominio_id, cargo_id, condominios(id, nome, logo_path, ativo)')
      .eq('usuario_id', userId)
      .eq('ativo', true);
    data = plain.data;
    error = plain.error;
  }
  let links = await attachCargos(data || []);
  links = await inferCargoViaRpc(links);
  links = await inferMoradorByUnidade(userId, links);
  return { links, error };
}

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [isGestaoTecnica, setIsGestaoTecnica] = useState(false);
  const [condoId, setCondoId] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branding, setBranding] = useState({ nome: '', logo: '', capa: '', visaoGeral: '', login: '' });

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let active = true;

    async function hydrate(nextSession) {
      setSession(nextSession);
      if (!nextSession?.user) {
        setProfile(null);
        setMemberships([]);
        setIsGestaoTecnica(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data: userRow, error: userErr } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', nextSession.user.id)
        .maybeSingle();
      if (userErr) setError(userErr.message);

      const { links: rawLinks, error: loadErr } = await loadMemberships(nextSession.user.id, false);
      if (loadErr) setError(loadErr.message);

      let rpcGT = false;
      const rpc = await supabase.rpc('user_is_gestao_tecnica');
      if (!rpc.error) rpcGT = rpc.data === true;
      const gestao = detectGestaoTecnica(userRow, nextSession.user, rawLinks) || rpcGT;
      const loaded = gestao
        ? await loadMemberships(nextSession.user.id, true)
        : { links: rawLinks, error: loadErr };
      if (loaded.error) setError(loaded.error.message);
      if (!active) return;
      setProfile(userRow);
      setIsGestaoTecnica(gestao);
      setMemberships(loaded.links || []);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => hydrate(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      hydrate(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const membership = useMemo(() => {
    const selected = memberships.find((item) => item.condominio_id === condoId) || null;
    if (isGestaoTecnica) return selected;
    return selected || memberships[0] || null;
  }, [memberships, condoId, isGestaoTecnica]);

  const cargoTipo = isGestaoTecnica ? 'gestao_tecnica' : (cargoFrom(membership)?.tipo || null);
  const activeCondoId = membership?.condominio_id || '';

  useEffect(() => {
    if (isGestaoTecnica) return;
    if (membership?.condominio_id && membership.condominio_id !== condoId) {
      setCondoId(membership.condominio_id);
      sessionStorage.setItem(STORAGE_KEY, membership.condominio_id);
    }
  }, [membership, condoId, isGestaoTecnica]);

  useEffect(() => {
    if (!activeCondoId) {
      setBranding({ nome: '', logo: '', capa: '', visaoGeral: '', login: '' });
      return undefined;
    }
    rememberBrandCondo(activeCondoId);
    let live = true;
    loadBranding(activeCondoId).then((next) => {
      if (live) setBranding(next);
    });
    return () => {
      live = false;
    };
  }, [activeCondoId]);

  const value = useMemo(
    () => ({
      configured: supabaseConfigured,
      session,
      profile,
      memberships,
      membership,
      isGestaoTecnica,
      condo: membership?.condominios || null,
      cargo: cargoFrom(membership) || { tipo: cargoTipo, nome: CARGO_LABEL[cargoTipo] || cargoTipo },
      cargoTipo,
      condoId: membership?.condominio_id || '',
      branding,
      loading,
      error,
      selectCondo(id) {
        setCondoId(id);
        sessionStorage.setItem(STORAGE_KEY, id);
        rememberBrandCondo(id);
      },
      async reloadMemberships() {
        if (!session?.user) return [];
        const { links, error: loadErr } = await loadMemberships(session.user.id, isGestaoTecnica);
        if (loadErr) {
          setError(loadErr.message);
          return memberships;
        }
        setMemberships(links || []);
        return links || [];
      },
      async signIn(email, password) {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      },
      async signOut() {
        await supabase.auth.signOut();
        sessionStorage.removeItem(STORAGE_KEY);
      },
    }),
    [session, profile, memberships, membership, isGestaoTecnica, cargoTipo, branding, loading, error]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession fora do provider');
  return ctx;
}
