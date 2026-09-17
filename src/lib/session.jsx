import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase';
import { loadBranding, rememberBrandCondo, forgetBrandCondo } from './branding';
import { CARGO_LABEL } from './permissions';
import {
  aplicarPrefs,
  bootstrapPrefs,
  DEFAULT_PREFS,
  lerPrefsLocais,
  precisaDefinirPreferencias,
  prefsDoPerfil,
  salvarPreferencias,
} from './prefs';

bootstrapPrefs();

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
  if (profile?.admin_sistema || profile?.gestao_tecnica) return true;
  if (metaFlag(authUser?.user_metadata?.admin_sistema) || metaFlag(authUser?.app_metadata?.admin_sistema)) return true;
  if (metaFlag(authUser?.user_metadata?.gestao_tecnica) || metaFlag(authUser?.app_metadata?.gestao_tecnica)) return true;
  if (authUser?.app_metadata?.role === 'admin_sistema' || authUser?.app_metadata?.role === 'gestao_tecnica') return true;
  return (links || []).some((item) => cargoFrom(item)?.tipo === 'gestao_tecnica');
}

export function detectAdminSistema(profile, authUser) {
  if (profile?.admin_sistema) return true;
  if (metaFlag(authUser?.user_metadata?.admin_sistema) || metaFlag(authUser?.app_metadata?.admin_sistema)) return true;
  return authUser?.app_metadata?.role === 'admin_sistema';
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

function asConstrutoraMemberships(condos) {
  return (condos || []).map((condo) => ({
    id: `ct-${condo.id}`,
    condominio_id: condo.id,
    ativo: true,
    cargos: { id: 'construtora', nome: 'Construtora', tipo: 'construtora' },
    condominios: condo,
  }));
}

function sameId(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && Boolean(a) && Boolean(b);
}

function detectConstrutoraOrg(profile, isGestaoTecnica) {
  if (isGestaoTecnica) return false;
  return Boolean(profile?.construtora_id);
}

async function construtoraIdDoUsuario(userRow) {
  if (userRow?.construtora_id) return userRow.construtora_id;
  const rpc = await supabase.rpc('usuario_construtora_id');
  if (!rpc.error && rpc.data) return rpc.data;
  return '';
}

async function temAcessoConstrutora(construtoraId, userRow) {
  if (!construtoraId) return false;
  const rpc = await supabase.rpc('tem_acesso_construtora', { p_construtora_id: construtoraId });
  if (!rpc.error) return rpc.data === true;
  const mine = await construtoraIdDoUsuario(userRow);
  if (sameId(mine, construtoraId)) return true;
  return false;
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

async function avaliarAcessoLogin(user, { condominioId = '', construtoraId = '' } = {}) {
  const { data: userRow } = await supabase.from('usuarios').select('*').eq('id', user.id).maybeSingle();
  const { links } = await loadMemberships(user.id, { gestao: false });
  const rpc = await supabase.rpc('user_is_gestao_tecnica');
  const gestao = detectGestaoTecnica(userRow, user, links)
    || rpc.data === true
    || detectAdminSistema(userRow, user);

  if (construtoraId) {
    if (gestao) return { ok: true };
    if (await temAcessoConstrutora(construtoraId, userRow)) return { ok: true };
    return { ok: false, message: 'Sua conta não tem acesso a esta construtora.' };
  }

  if (!condominioId) {
    if (!gestao) {
      return {
        ok: false,
        message: 'Este acesso é exclusivo da Gestão Técnica. Entre pelo link de login do seu condomínio ou da construtora.',
      };
    }
    return { ok: true };
  }

  if (gestao) return { ok: true };

  const orgId = await construtoraIdDoUsuario(userRow);
  if (orgId) {
    const { data: condo } = await supabase
      .from('condominios')
      .select('id, construtora_id')
      .eq('id', condominioId)
      .maybeSingle();
    if (sameId(condo?.construtora_id, orgId)) return { ok: true };
    const rpc = await supabase.rpc('user_is_construtora_org_do_condominio', { cid: condominioId });
    if (!rpc.error && rpc.data === true) return { ok: true };
  }

  const belongs = (links || []).some((row) => row.condominio_id === condominioId);
  if (!belongs) {
    return { ok: false, message: 'Sua conta não tem acesso a este condomínio.' };
  }
  return { ok: true };
}

async function loadCondoList(select) {
  let { data, error } = await supabase.from('condominios').select(select).order('nome');
  if (error && /construtora/i.test(error.message || '')) {
    const fallback = await supabase
      .from('condominios')
      .select('id, nome, logo_path, ativo, dominio')
      .order('nome');
    data = fallback.data;
    error = fallback.error;
  }
  if (error && /dominio/i.test(error.message || '')) {
    const plain = await supabase.from('condominios').select('id, nome, logo_path, ativo').order('nome');
    data = plain.data;
    error = plain.error;
  }
  return { data, error };
}

async function urlFotoPerfil(path) {
  if (!path || !supabase) return '';
  const signed = await supabase.storage.from('condominios').createSignedUrl(path, 60 * 60 * 24 * 7);
  return signed.data?.signedUrl || '';
}

async function loadMemberships(userId, { gestao = false, construtoraId = '' } = {}) {
  if (gestao) {
    const withId = await loadCondoList('id, nome, logo_path, ativo, dominio, construtora_id');
    if (!withId.error) {
      const withJoin = await loadCondoList('id, nome, logo_path, ativo, dominio, construtora_id, construtoras(id, nome, nome_fantasia, razao_social)');
      return { links: asGestaoMemberships((withJoin.error ? withId.data : withJoin.data) || []), error: null };
    }
    const plain = await loadCondoList('id, nome, logo_path, ativo, dominio');
    return { links: asGestaoMemberships(plain.data), error: plain.error };
  }
  if (construtoraId) {
    const withArg = await supabase.rpc('listar_condominios_da_minha_construtora', {
      p_construtora_id: construtoraId,
    });
    if (!withArg.error && Array.isArray(withArg.data) && withArg.data.length) {
      return { links: asConstrutoraMemberships(withArg.data), error: null };
    }
    const noArg = withArg.error
      ? await supabase.rpc('listar_condominios_da_minha_construtora')
      : withArg;
    if (!noArg.error && Array.isArray(noArg.data) && noArg.data.length) {
      return { links: asConstrutoraMemberships(noArg.data), error: null };
    }
    let { data, error } = await supabase
      .from('condominios')
      .select('id, nome, logo_path, ativo, dominio, construtora_id')
      .eq('construtora_id', construtoraId)
      .order('nome');
    if ((error && /construtora_id|dominio/i.test(error.message || '')) || (!error && !data?.length)) {
      const plain = await supabase
        .from('condominios')
        .select('id, nome, logo_path, ativo, construtora_id')
        .eq('construtora_id', construtoraId)
        .order('nome');
      if (!plain.error) {
        data = plain.data;
        error = null;
      } else if (error) {
        error = plain.error;
      }
    }
    if (userId && data?.length) {
      const escopo = await supabase
        .from('usuario_construtora_escopo')
        .select('condominio_id')
        .eq('usuario_id', userId);
      if (!escopo.error && escopo.data?.length) {
        const allowed = new Set(escopo.data.map((row) => row.condominio_id));
        data = data.filter((condo) => allowed.has(condo.id));
      }
    }
    return { links: asConstrutoraMemberships(data), error: error || noArg.error || withArg.error };
  }
  let { data, error } = await supabase
    .from('usuario_condominio')
    .select('id, ativo, condominio_id, cargo_id, cargos(id, nome, tipo), condominios(id, nome, logo_path, ativo, dominio)')
    .eq('usuario_id', userId)
    .eq('ativo', true);
  if (error) {
    const withoutDomain = await supabase
      .from('usuario_condominio')
      .select('id, ativo, condominio_id, cargo_id, cargos(id, nome, tipo), condominios(id, nome, logo_path, ativo)')
      .eq('usuario_id', userId)
      .eq('ativo', true);
    data = withoutDomain.data;
    error = withoutDomain.error;
  }
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
  const [isAdminSistema, setIsAdminSistema] = useState(false);
  const [construtora, setConstrutora] = useState(null);
  const [condoId, setCondoId] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branding, setBranding] = useState({ nome: '', logo: '', capa: '', visaoGeral: '', login: '' });
  const [fotoUrl, setFotoUrl] = useState('');

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    const ready = { current: false };

    async function hydrate(nextSession, { showLoader = false } = {}) {
      if (!nextSession?.user) {
        setSession(null);
        setProfile(null);
        setMemberships([]);
        setIsGestaoTecnica(false);
        setIsAdminSistema(false);
        setConstrutora(null);
        setFotoUrl('');
        setLoading(false);
        ready.current = true;
        return;
      }
      setSession(nextSession);
      if (showLoader && !ready.current) setLoading(true);
      const { data: loadedUser, error: userErr } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', nextSession.user.id)
        .maybeSingle();
      if (userErr) setError(userErr.message);
      const orgId = await construtoraIdDoUsuario(loadedUser);
      const userRow = orgId && !loadedUser?.construtora_id
        ? { ...(loadedUser || {}), construtora_id: orgId }
        : loadedUser;

      const { links: rawLinks, error: loadErr } = await loadMemberships(nextSession.user.id, { gestao: false });
      if (loadErr) setError(loadErr.message);

      let rpcGT = false;
      const rpc = await supabase.rpc('user_is_gestao_tecnica');
      if (!rpc.error) rpcGT = rpc.data === true;
      const admin = detectAdminSistema(userRow, nextSession.user);
      const gestao = detectGestaoTecnica(userRow, nextSession.user, rawLinks) || rpcGT || admin;
      const org = detectConstrutoraOrg(userRow, gestao);
      let orgRow = null;
      if (org && userRow?.construtora_id) {
        const found = await supabase
          .from('construtoras')
          .select('id, nome, nome_fantasia, razao_social, logo_path, dominio, ativo')
          .eq('id', userRow.construtora_id)
          .maybeSingle();
        orgRow = found.data || { id: userRow.construtora_id, nome: 'Construtora' };
        if (found.error && /nome_fantasia|razao_social/i.test(found.error.message || '')) {
          const fallback = await supabase
            .from('construtoras')
            .select('id, nome, logo_path, dominio, ativo')
            .eq('id', userRow.construtora_id)
            .maybeSingle();
          orgRow = fallback.data || orgRow;
        }
        if (!found.data?.id) {
          const marca = await supabase.rpc('marca_construtora', { p_id: userRow.construtora_id });
          const row = typeof marca.data === 'string' ? JSON.parse(marca.data || 'null') : marca.data;
          if (row?.id) {
            orgRow = {
              id: row.id,
              nome: row.nome || row.nome_fantasia || row.razao_social || 'Construtora',
              nome_fantasia: row.nome_fantasia,
              razao_social: row.razao_social,
              logo_path: row.logo,
              dominio: row.dominio,
            };
          }
        }
      }
      const loaded = gestao
        ? await loadMemberships(nextSession.user.id, { gestao: true })
        : org
          ? await loadMemberships(nextSession.user.id, { construtoraId: userRow.construtora_id })
          : { links: rawLinks, error: loadErr };
      if (loaded.error) setError(loaded.error.message);
      if (!active) return;
      setProfile(userRow);
      setIsGestaoTecnica(gestao);
      setIsAdminSistema(admin);
      setConstrutora(orgRow);
      setMemberships(loaded.links || []);
      if (userRow?.foto_path) {
        urlFotoPerfil(userRow.foto_path).then((url) => {
          if (active) setFotoUrl(url || '');
        });
      } else {
        setFotoUrl('');
      }
      const fromProfile = prefsDoPerfil(userRow);
      if (fromProfile) aplicarPrefs(fromProfile);
      else if (!precisaDefinirPreferencias(userRow)) aplicarPrefs(lerPrefsLocais() || DEFAULT_PREFS);
      setLoading(false);
      ready.current = true;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (active) hydrate(data.session, { showLoader: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (next) setSession(next);
        return;
      }
      if (event === 'INITIAL_SESSION' && ready.current) return;
      setTimeout(() => {
        if (!active) return;
        hydrate(next, { showLoader: !ready.current });
      }, 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isConstrutoraOrg = Boolean(profile?.construtora_id || construtora?.id) && !isGestaoTecnica;

  const membership = useMemo(() => {
    const selected = memberships.find((item) => item.condominio_id === condoId) || null;
    if (isGestaoTecnica || isConstrutoraOrg) return selected;
    return selected || memberships[0] || null;
  }, [memberships, condoId, isGestaoTecnica, isConstrutoraOrg]);

  const cargoTipo = isGestaoTecnica
    ? 'gestao_tecnica'
    : (isConstrutoraOrg ? 'construtora' : (cargoFrom(membership)?.tipo || null));
  const activeCondoId = membership?.condominio_id || '';

  useEffect(() => {
    if (isGestaoTecnica || isConstrutoraOrg) return;
    if (membership?.condominio_id && membership.condominio_id !== condoId) {
      setCondoId(membership.condominio_id);
      sessionStorage.setItem(STORAGE_KEY, membership.condominio_id);
    }
  }, [membership, condoId, isGestaoTecnica, isConstrutoraOrg]);

  useEffect(() => {
    if (!activeCondoId) {
      setBranding({ nome: '', logo: '', capa: '', visaoGeral: '', login: '' });
      return undefined;
    }
    rememberBrandCondo(activeCondoId);
    let live = true;
    loadBranding(activeCondoId).then((next) => {
      if (live) setBranding(next);
    }).catch(() => {
      if (live) setBranding((prev) => prev || { nome: '', logo: '', capa: '', visaoGeral: '', login: '' });
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
      isAdminSistema,
      isConstrutoraOrg,
      construtora,
      condo: membership?.condominios || null,
      cargo: cargoFrom(membership) || { tipo: cargoTipo, nome: CARGO_LABEL[cargoTipo] || cargoTipo },
      cargoTipo,
      condoId: membership?.condominio_id || '',
      branding,
      fotoUrl,
      loading,
      error,
      needsPreferencias: precisaDefinirPreferencias(profile),
      selectCondo(id) {
        if (!id) return;
        if (!isGestaoTecnica && !isConstrutoraOrg && !memberships.some((item) => item.condominio_id === id)) return;
        setCondoId(id);
        sessionStorage.setItem(STORAGE_KEY, id);
        rememberBrandCondo(id);
      },
      async savePreferencias(prefs) {
        if (!session?.user?.id) throw new Error('Sessão inválida.');
        const row = await salvarPreferencias(session.user.id, prefs);
        if (row) setProfile(row);
        else {
          setProfile((prev) => ({
            ...(prev || {}),
            tema: prefs.tema,
            tamanho_fonte: prefs.tamanho_fonte,
            preferencias_ok: true,
          }));
        }
        return row;
      },
      async reloadMemberships() {
        if (!session?.user) return [];
        const { links, error: loadErr } = await loadMemberships(session.user.id, {
          gestao: isGestaoTecnica,
          construtoraId: isConstrutoraOrg ? (construtora?.id || profile?.construtora_id) : '',
        });
        if (loadErr) {
          setError(loadErr.message);
          return memberships;
        }
        setMemberships(links || []);
        return links || [];
      },
      async signIn(email, password, { condominioId, construtoraId } = {}) {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        if (data.session) await supabase.auth.setSession(data.session);
        const acesso = await avaliarAcessoLogin(data.user, {
          condominioId: condominioId || '',
          construtoraId: construtoraId || '',
        });
        if (!acesso.ok) {
          await supabase.auth.signOut();
          sessionStorage.removeItem(STORAGE_KEY);
          throw new Error(acesso.message);
        }
        if (condominioId && !construtoraId) {
          setCondoId(condominioId);
          sessionStorage.setItem(STORAGE_KEY, condominioId);
          rememberBrandCondo(condominioId);
        } else {
          setCondoId('');
          sessionStorage.removeItem(STORAGE_KEY);
        }
      },
      async signOut({ to } = {}) {
        const destino = to || '/login';
        sessionStorage.setItem('cca.logoutTo', destino);
        if (destino === '/login') forgetBrandCondo();
        await supabase.auth.signOut();
        sessionStorage.removeItem(STORAGE_KEY);
      },
    }),
    [session, profile, memberships, membership, isGestaoTecnica, isAdminSistema, isConstrutoraOrg, construtora, cargoTipo, branding, fotoUrl, loading, error]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession fora do provider');
  return ctx;
}
