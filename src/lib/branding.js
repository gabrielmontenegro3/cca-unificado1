import { supabase } from './supabase';

export const BRAND_KEY = 'cca.brandCondo';

export const BRAND_TIPOS = {
  logo: 'logo',
  visao_geral: 'visao_geral',
  capa: 'capa',
  login: 'login',
};

const TITLE_TO_TIPO = {
  logo: 'logo',
  'imagem visao geral': 'visao_geral',
  'imagem visão geral': 'visao_geral',
  'visao geral': 'visao_geral',
  'visão geral': 'visao_geral',
  'imagem capa': 'capa',
  capa: 'capa',
  'imagem login': 'login',
  login: 'login',
};

export function tipoDaImagem(row) {
  if (row?.tipo && BRAND_TIPOS[row.tipo]) return row.tipo;
  const title = String(row?.titulo || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return TITLE_TO_TIPO[title] || TITLE_TO_TIPO[String(row?.titulo || '').toLowerCase()] || null;
}

export function isBrandImage(row) {
  return Boolean(tipoDaImagem(row));
}

export function rememberBrandCondo(id) {
  if (id) localStorage.setItem(BRAND_KEY, id);
}

export function rememberedBrandCondo() {
  return localStorage.getItem(BRAND_KEY) || '';
}

export function forgetBrandCondo() {
  localStorage.removeItem(BRAND_KEY);
}

export function appOrigin() {
  const configured = String(import.meta.env.VITE_APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export function appUrl(path) {
  const origin = appOrigin();
  const suffix = String(path || '').replace(/^\/+/, '');
  return origin ? `${origin}/${suffix}` : `/${suffix}`;
}

export function isCondoUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

export function slugCondominio(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizarDominio(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    return String(url.hostname || '')
      .toLowerCase()
      .replace(/\.$/, '');
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/\.$/, '')
      .trim();
  }
}

export function ehHostPrincipal(host) {
  const h = normalizarDominio(host);
  if (!h || h === 'localhost' || h === '127.0.0.1') return true;
  const app = normalizarDominio(appOrigin() || (typeof window !== 'undefined' ? window.location.origin : ''));
  return Boolean(app && h === app);
}

export function loginPathDoCondominio(nome, fallbackId = '') {
  const ref = slugCondominio(nome) || fallbackId;
  return ref ? `/login/${ref}` : '/login';
}

export function loginUrlDoCondominio(condoId, nome) {
  const path = loginPathDoCondominio(nome, condoId).replace(/^\/+/, '');
  return path ? appUrl(path) : '';
}

export function loginPathDaConstrutora(nome, fallbackId = '') {
  return loginPathDoCondominio(nome, fallbackId);
}

export function loginUrlDaConstrutora(id, nome) {
  return loginUrlDoCondominio(id, nome);
}

export function nomeExibicaoConstrutora(row) {
  return String(row?.nome_fantasia || row?.nome || row?.razao_social || '').trim();
}

export function dominioUrlDoCondominio(dominio) {
  const host = normalizarDominio(dominio);
  return host ? `https://${host}` : '';
}

export async function resolverLoginCondominio(ref) {
  const portal = await resolverLoginPortal(ref);
  if (portal?.tipo === 'condominio') return portal.id;
  if (isCondoUuid(ref) && !portal) return String(ref || '').trim();
  return '';
}

export async function resolverLoginPortal(ref) {
  const value = decodeURIComponent(String(ref || '').trim());
  if (!value || !supabase) return null;

  const rpc = await supabase.rpc('resolver_login_portal', { p_ref: value });
  if (!rpc.error && rpc.data) {
    const row = typeof rpc.data === 'string' ? JSON.parse(rpc.data) : rpc.data;
    if (row?.id && row?.tipo) return { tipo: row.tipo, id: row.id };
  }

  if (isCondoUuid(value)) {
    const construtora = await supabase.from('construtoras').select('id').eq('id', value).maybeSingle();
    if (construtora.data?.id) return { tipo: 'construtora', id: construtora.data.id };
    return { tipo: 'condominio', id: value };
  }

  const slug = slugCondominio(value);
  const [{ data: construtoras }, { data: condos }] = await Promise.all([
    supabase.from('construtoras').select('id, nome, nome_fantasia, razao_social, dominio'),
    supabase.from('condominios').select('id, nome, dominio'),
  ]);
  const bySlug = (rows, tipo) => {
    const match = (rows || []).find((row) => {
      const names = [row.nome, row.nome_fantasia, row.razao_social].filter(Boolean);
      return names.some((name) => {
        const rowSlug = slugCondominio(name);
        return rowSlug === slug || String(name || '').toLowerCase().trim() === value.toLowerCase();
      });
    });
    return match?.id ? { tipo, id: match.id } : null;
  };
  return bySlug(construtoras, 'construtora') || bySlug(condos, 'condominio');
}

export function conviteUrl(token) {
  if (!token) return '';
  return appUrl(`convite/${token}`);
}

const COVER_TRANSFORM = { width: 2560, quality: 92, resize: 'contain' };
const COMPACT_TRANSFORM = { width: 960, quality: 65, resize: 'contain' };
const SIGN_TTL = 60 * 60 * 24 * 7;

let transformsEnabled = true;

function transformFor(tipo) {
  if (!transformsEnabled) return undefined;
  if (tipo === 'capa') return COVER_TRANSFORM;
  if (tipo === 'logo') return undefined;
  return COMPACT_TRANSFORM;
}

function storageErr(error) {
  return String(error?.message || error?.error || error?.statusCode || '').toLowerCase();
}

function isMissingObject(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  if (status === 404) return true;
  const msg = storageErr(error);
  return /not found|does not exist|no such file|object not found/.test(msg);
}

async function signPath(path, transform) {
  if (!path || !supabase) return '';
  const expiresIn = SIGN_TTL;
  if (transformsEnabled && transform) {
    const hi = await supabase.storage.from('condominios').createSignedUrl(path, expiresIn, { transform });
    if (hi.data?.signedUrl) return hi.data.signedUrl;
    if (isMissingObject(hi.error)) return '';
    if (hi.error) transformsEnabled = false;
  }
  const signed = await supabase.storage.from('condominios').createSignedUrl(path, expiresIn);
  if (signed.data?.signedUrl) return signed.data.signedUrl;
  return '';
}

function tipoFromMarcaName(name) {
  const stem = String(name || '').toLowerCase().replace(/\.[^.]+$/, '');
  return BRAND_TIPOS[stem] ? stem : null;
}

function emptyBrand() {
  return { nome: '', logo: '', capa: '', visaoGeral: '', login: '' };
}

function asMarcaRow(data) {
  if (!data) return null;
  let row = data;
  if (typeof row === 'string') {
    try {
      row = JSON.parse(row);
    } catch {
      return null;
    }
  }
  if (Array.isArray(row)) row = row[0];
  if (!row || typeof row !== 'object') return null;
  return row;
}

function applyRpc(brand, row) {
  const data = asMarcaRow(row);
  if (!data) return {};
  brand.nome = data.nome || brand.nome;
  return {
    logo: data.logo || data.logo_path || '',
    capa: data.capa || '',
    visao_geral: data.visao_geral || '',
    login: data.login || '',
  };
}

async function fillFromStorageFolder(condoId, brand) {
  const { data: files, error } = await supabase.storage
    .from('condominios')
    .list(`${condoId}/marca`, { limit: 50 });
  if (error || !files?.length) return;

  for (const file of files) {
    const tipo = tipoFromMarcaName(file.name);
    if (!tipo) continue;
    const already = tipo === 'visao_geral' ? brand.visaoGeral : brand[tipo];
    if (already) continue;
    const url = await signPath(`${condoId}/marca/${file.name}`, transformFor(tipo));
    if (!url) continue;
    if (tipo === 'logo') brand.logo = url;
    if (tipo === 'capa') brand.capa = url;
    if (tipo === 'visao_geral') brand.visaoGeral = url;
    if (tipo === 'login') brand.login = url;
  }
}

async function fillFromTables(condoId, brand) {
  const [{ data: condo }, { data: images }] = await Promise.all([
    supabase.from('condominios').select('nome, logo_path').eq('id', condoId).maybeSingle(),
    supabase.from('imagens_condominio').select('id, titulo, tipo, arquivo_id').eq('condominio_id', condoId),
  ]);
  brand.nome = brand.nome || condo?.nome || '';
  if (!brand.logo && condo?.logo_path) brand.logo = await signPath(condo.logo_path);

  const fileIds = [...new Set((images || []).map((row) => row.arquivo_id).filter(Boolean))];
  let filesById = {};
  if (fileIds.length) {
    const files = await supabase.from('arquivos').select('id, storage_path').in('id', fileIds);
    for (const file of files.data || []) filesById[file.id] = file.storage_path;
  }

  for (const row of images || []) {
    const tipo = tipoDaImagem(row);
    const path = filesById[row.arquivo_id];
    if (!tipo || !path) continue;
    const url = await signPath(path, transformFor(tipo));
    if (!url) continue;
    if (tipo === 'logo' && !brand.logo) brand.logo = url;
    if (tipo === 'capa' && !brand.capa) brand.capa = url;
    if (tipo === 'visao_geral' && !brand.visaoGeral) brand.visaoGeral = url;
    if (tipo === 'login' && !brand.login) brand.login = url;
  }
}

export async function loadBrandingConstrutora(id) {
  const brand = emptyBrand();
  if (!id || !supabase) return brand;

  const rpc = await supabase.rpc('marca_construtora', { p_id: id });
  if (!rpc.error && rpc.data) {
    const row = typeof rpc.data === 'string' ? JSON.parse(rpc.data) : rpc.data;
    brand.nome = row?.nome || row?.nome_fantasia || brand.nome;
    brand.razaoSocial = row?.razao_social || '';
    brand.nomeFantasia = row?.nome_fantasia || brand.nome;
    if (row?.logo) brand.logo = await signPath(row.logo);
  }
  if (!brand.nome || !brand.logo) {
    const { data } = await supabase
      .from('construtoras')
      .select('nome, nome_fantasia, razao_social, logo_path')
      .eq('id', id)
      .maybeSingle();
    brand.nome = brand.nome || nomeExibicaoConstrutora(data);
    brand.razaoSocial = brand.razaoSocial || data?.razao_social || '';
    brand.nomeFantasia = brand.nomeFantasia || data?.nome_fantasia || brand.nome;
    if (!brand.logo && data?.logo_path) brand.logo = await signPath(data.logo_path);
  }
  return brand;
}

export async function loadBranding(condoId) {
  const brand = emptyBrand();
  if (!condoId || !supabase) return brand;

  try {
    const rpc = await supabase.rpc('marca_condominio', { p_condominio_id: condoId });
    if (!rpc.error && rpc.data) {
      const row = asMarcaRow(rpc.data);
      brand.nome = row?.nome || brand.nome;
      const paths = applyRpc(brand, row);
      if (paths.logo) brand.logo = await signPath(paths.logo);
      if (paths.capa) brand.capa = await signPath(paths.capa, COVER_TRANSFORM);
      if (paths.visao_geral) brand.visaoGeral = await signPath(paths.visao_geral, COMPACT_TRANSFORM);
      if (paths.login) brand.login = await signPath(paths.login, COMPACT_TRANSFORM);
    }
  } catch {
    /* continua pelos fallbacks */
  }

  if (!brand.logo || !brand.capa || !brand.visaoGeral || !brand.login) {
    try {
      await fillFromStorageFolder(condoId, brand);
    } catch {
      /* ok */
    }
  }
  if (!brand.logo || !brand.capa || !brand.visaoGeral || !brand.login || !brand.nome) {
    try {
      await fillFromTables(condoId, brand);
    } catch {
      /* ok */
    }
  }
  return brand;
}
