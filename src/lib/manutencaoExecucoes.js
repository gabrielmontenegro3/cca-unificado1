import { supabase } from './supabase';
import { publicOrSignedUrl } from './api';

const CAMPOS_ARQUIVO = 'id, nome_original, storage_path, mime_type, tipo, tamanho_bytes';
const CAMPOS_REGISTRO = 'id, sistema, subsistema, data_execucao, observacao, created_at, usuarios:executado_por(nome)';
const CAMPOS_REGISTRO_ANTIGO = 'id, subsistema, data_execucao, observacao, created_at, usuarios:executado_por(nome)';

export const SQL_MANUTENCAO = 'supabase/manutencao-execucoes-relatorio.sql';
export const SQL_ANEXOS = 'supabase/manutencao-execucao-arquivos.sql';
export const SQL_SISTEMAS = 'supabase/manutencao-sistemas-construtivos.sql';

export function mensagemSqlManutencao(err) {
  const msg = String(err?.message || err || '');
  if (/manutencao_sistemas|p_sistema|sistema construtivo|column [^ ]*sistema|sistema does not exist|PGRST202/i.test(msg)) {
    return `Rode o arquivo ${SQL_SISTEMAS} no SQL Editor do Supabase e tente de novo.`;
  }
  if (/manutencao_registro_arquivos|p_arquivos|pode_ver_manutencao/i.test(msg)) {
    return `Rode o arquivo ${SQL_ANEXOS} no SQL Editor do Supabase e tente de novo.`;
  }
  if (/manutencao_documentos|manutencao_subsistemas|manutencao_registros|registrar_execucao_manutencao|schema cache|does not exist|42P01|PGRST204|PGRST205/i.test(msg)) {
    return `Rode o arquivo ${SQL_MANUTENCAO} no SQL Editor do Supabase e tente de novo.`;
  }
  return msg || 'Não foi possível concluir.';
}

function um(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function comUrls(arquivos) {
  return Promise.all(arquivos.map(async (arquivo) => {
    if (!arquivo?.storage_path) return { ...arquivo, url: '' };
    const { data } = await publicOrSignedUrl(arquivo.storage_path);
    return { ...arquivo, url: data?.signedUrl || '' };
  }));
}

function semColunaSistema(error) {
  return /sistema/i.test(String(error?.message || '')) && /column|does not exist|42703|PGRST204/i.test(String(error?.message || error?.code || ''));
}

function semAnexos(error) {
  return /manutencao_registro_arquivos|relationship|PGRST200/i.test(String(error?.message || error?.code || ''));
}

/**
 * Execuções do condomínio, mais recentes primeiro, já com os arquivos e links.
 * Cada linha volta com `sistema` (execuções antigas usam o próprio subsistema).
 * Se a tabela de anexos ou a coluna de sistema ainda não existirem, avisa em `aviso`.
 */
export async function carregarExecucoes(condoId, { limit } = {}) {
  async function buscar(campos, comAnexos) {
    let query = supabase
      .from('manutencao_registros')
      .select(comAnexos ? `${campos}, manutencao_registro_arquivos(ordem, arquivos(${CAMPOS_ARQUIVO}))` : campos)
      .eq('condominio_id', condoId)
      .order('data_execucao', { ascending: false })
      .order('created_at', { ascending: false });
    if (limit) query = query.limit(limit);
    return query;
  }

  const avisos = [];
  let campos = CAMPOS_REGISTRO;
  let comAnexos = true;
  let { data, error } = await buscar(campos, comAnexos);
  if (error && semColunaSistema(error)) {
    avisos.push(`Para separar as execuções por sistema construtivo, rode ${SQL_SISTEMAS} no SQL Editor do Supabase.`);
    campos = CAMPOS_REGISTRO_ANTIGO;
    ({ data, error } = await buscar(campos, comAnexos));
  }
  if (error && semAnexos(error)) {
    avisos.push(`Para anexar arquivos às execuções, rode ${SQL_ANEXOS} no SQL Editor do Supabase.`);
    comAnexos = false;
    ({ data, error } = await buscar(campos, comAnexos));
  }
  if (error) throw error;

  const rows = await Promise.all((data || []).map(async (row) => {
    const vinculos = [...(row.manutencao_registro_arquivos || [])]
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
      .map((v) => um(v.arquivos))
      .filter(Boolean);
    return {
      ...row,
      sistema: String(row.sistema || '').trim() || row.subsistema,
      usuario: um(row.usuarios),
      arquivos: await comUrls(vinculos),
    };
  }));
  return { rows, aviso: avisos.join(' ') };
}

/**
 * Sistemas construtivos salvos e os subsistemas de cada um.
 * Volta `{ sistemas: string[], subsistemas: { sistema, nome }[], aviso }`.
 */
export async function carregarSistemasManutencao(condoId) {
  const [sis, subs] = await Promise.all([
    supabase.from('manutencao_sistemas').select('nome').eq('condominio_id', condoId).order('nome'),
    supabase.from('manutencao_subsistemas').select('sistema, nome').eq('condominio_id', condoId).order('nome'),
  ]);
  const faltaSql = Boolean(sis.error) || (subs.error && semColunaSistema(subs.error));
  return {
    sistemas: sis.error ? [] : (sis.data || []).map((row) => row.nome),
    subsistemas: subs.error ? [] : (subs.data || []).filter((row) => row.sistema),
    aviso: faltaSql ? `Rode ${SQL_SISTEMAS} no SQL Editor do Supabase para separar sistemas e subsistemas.` : '',
  };
}
