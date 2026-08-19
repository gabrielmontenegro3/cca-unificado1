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

const BRAND_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];

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

export function loginUrlDoCondominio(condoId) {
  if (!condoId) return '';
  return appUrl(`login/${condoId}`);
}

export function conviteUrl(token) {
  if (!token) return '';
  return appUrl(`convite/${token}`);
}

async function signPath(path) {
  if (!path || !supabase) return '';
  const signed = await supabase.storage.from('condominios').createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signed.data?.signedUrl) return signed.data.signedUrl;
  const file = await supabase.storage.from('condominios').download(path);
  if (file.data) return URL.createObjectURL(file.data);
  return '';
}

function emptyBrand() {
  return { nome: '', logo: '', capa: '', visaoGeral: '', login: '' };
}

function applyRpc(brand, row) {
  if (!row || typeof row !== 'object') return;
  brand.nome = row.nome || brand.nome;
  return {
    logo: row.logo || row.logo_path || '',
    capa: row.capa || '',
    visao_geral: row.visao_geral || '',
    login: row.login || '',
  };
}

async function fillFromStorageFolder(condoId, brand) {
  for (const tipo of Object.keys(BRAND_TIPOS)) {
    const already = tipo === 'visao_geral' ? brand.visaoGeral : brand[tipo];
    if (already) continue;
    for (const ext of BRAND_EXTS) {
      const url = await signPath(`${condoId}/marca/${tipo}.${ext}`);
      if (!url) continue;
      if (tipo === 'logo') brand.logo = url;
      if (tipo === 'capa') brand.capa = url;
      if (tipo === 'visao_geral') brand.visaoGeral = url;
      if (tipo === 'login') brand.login = url;
      break;
    }
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
    const url = await signPath(path);
    if (!url) continue;
    if (tipo === 'logo' && !brand.logo) brand.logo = url;
    if (tipo === 'capa' && !brand.capa) brand.capa = url;
    if (tipo === 'visao_geral' && !brand.visaoGeral) brand.visaoGeral = url;
    if (tipo === 'login' && !brand.login) brand.login = url;
  }
}

export async function loadBranding(condoId) {
  const brand = emptyBrand();
  if (!condoId || !supabase) return brand;

  const rpc = await supabase.rpc('marca_condominio', { p_condominio_id: condoId });
  if (!rpc.error && rpc.data) {
    const row = typeof rpc.data === 'string' ? JSON.parse(rpc.data) : rpc.data;
    brand.nome = row?.nome || brand.nome;
    const paths = applyRpc(brand, row) || {};
    if (paths.logo) brand.logo = await signPath(paths.logo);
    if (paths.capa) brand.capa = await signPath(paths.capa);
    if (paths.visao_geral) brand.visaoGeral = await signPath(paths.visao_geral);
    if (paths.login) brand.login = await signPath(paths.login);
  }

  if (!brand.logo || !brand.capa || !brand.visaoGeral || !brand.login) {
    await fillFromStorageFolder(condoId, brand);
  }
  if (!brand.logo || !brand.capa || !brand.visaoGeral || !brand.login || !brand.nome) {
    await fillFromTables(condoId, brand);
  }
  return brand;
}
