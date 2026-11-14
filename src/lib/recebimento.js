import { supabase } from './supabase';
import { publicOrSignedUrl, uploadArquivo, arquivoEhImagem } from './api';
import { labelUnidade } from './format';

export const SQL_RECEBIMENTO = 'supabase/recebimento-vistoria.sql';

/** Tipos de registro da linha do tempo de entrega. */
export const TIPOS_RECEBIMENTO = {
  vistoria_agendada: { label: 'Vistoria de entrega agendada', curto: 'Vistoria agendada', icon: 'calendar' },
  problema: { label: 'Problema encontrado', curto: 'Problema', icon: 'alert' },
  vistoria_solicitada: { label: 'Vistoria solicitada pelo morador', curto: 'Vistoria solicitada', icon: 'message' },
  vistoria_realizada: { label: 'Vistoria realizada', curto: 'Vistoria realizada', icon: 'check' },
  construtora: { label: 'Registro da construtora', curto: 'Construtora', icon: 'building' },
  assinatura_entrega: { label: 'Assinatura de entrega', curto: 'Entrega assinada', icon: 'verified' },
};

export const PAPEL_LABEL = {
  gestao_tecnica: 'Gestão Técnica',
  construtora: 'Construtora',
  morador: 'Morador',
  administracao: 'Administração',
  administrador: 'Administrador',
};

export const STATUS_UNIDADE = {
  sem_vistoria: { label: 'Sem vistoria', tom: 'neutro' },
  solicitada: { label: 'Vistoria solicitada', tom: 'alerta' },
  agendada: { label: 'Vistoria agendada', tom: 'info' },
  pendencias: { label: 'Com pendências', tom: 'alerta' },
  em_andamento: { label: 'Em andamento', tom: 'info' },
  entregue: { label: 'Entregue', tom: 'ok' },
};

/** Tipos que cada papel pode registrar. */
export function tiposPermitidos({ isGestaoTecnica, ehConstrutora, ehMorador }) {
  if (isGestaoTecnica) return ['vistoria_agendada', 'problema', 'vistoria_realizada', 'assinatura_entrega'];
  if (ehConstrutora) return ['construtora'];
  if (ehMorador) return ['vistoria_solicitada'];
  return [];
}

export function mensagemErroRecebimento(err) {
  const msg = String(err?.message || err || '');
  if (/recebimento_(registros|mensagens|arquivos)|pode_ver_recebimento|schema cache|PGRST20[0-5]|42P01/i.test(msg)) {
    return `Rode o arquivo ${SQL_RECEBIMENTO} no SQL Editor do Supabase e tente de novo.`;
  }
  if (/row-level security|42501/i.test(msg)) {
    return 'Você não tem permissão para este registro.';
  }
  return msg || 'Não foi possível concluir.';
}

export function tituloRegistro(registro) {
  const meta = TIPOS_RECEBIMENTO[registro?.tipo];
  if (registro?.tipo === 'problema' || registro?.tipo === 'construtora') {
    return String(registro.titulo || '').trim() || meta?.label || 'Registro';
  }
  return meta?.label || 'Registro';
}

export function statusDaUnidade(registros) {
  const lista = registros || [];
  if (!lista.length) return 'sem_vistoria';
  if (lista.some((r) => r.tipo === 'assinatura_entrega')) return 'entregue';
  if (lista.some((r) => r.tipo === 'problema' && !r.resolvido)) return 'pendencias';
  const ordenados = [...lista].sort((a, b) => String(a.data_evento).localeCompare(String(b.data_evento)));
  const ultimo = ordenados[ordenados.length - 1];
  if (ultimo?.tipo === 'vistoria_solicitada') return 'solicitada';
  if (lista.some((r) => r.tipo === 'vistoria_agendada') && !lista.some((r) => r.tipo === 'vistoria_realizada' || r.tipo === 'problema')) {
    return 'agendada';
  }
  return 'em_andamento';
}

async function comUrl(arquivo) {
  if (!arquivo?.storage_path) return { ...arquivo, isImage: arquivoEhImagem(arquivo) };
  const { data } = await publicOrSignedUrl(arquivo.storage_path);
  return { ...arquivo, url: data?.signedUrl || '', isImage: arquivoEhImagem(arquivo) };
}

const CAMPOS_ARQUIVO = 'id, nome_original, storage_path, mime_type, tipo, tamanho_bytes';

/** Unidades do condomínio com o status da entrega de cada uma. */
export async function listarUnidadesRecebimento(condoId) {
  const [unidades, registros] = await Promise.all([
    supabase.from('unidades').select('id, identificacao, bloco, andar').eq('condominio_id', condoId),
    supabase
      .from('recebimento_registros')
      .select('id, unidade_id, tipo, resolvido, data_evento')
      .eq('condominio_id', condoId),
  ]);
  if (unidades.error) throw unidades.error;
  if (registros.error) throw registros.error;
  const porUnidade = new Map();
  for (const r of registros.data || []) {
    if (!porUnidade.has(r.unidade_id)) porUnidade.set(r.unidade_id, []);
    porUnidade.get(r.unidade_id).push(r);
  }
  return (unidades.data || [])
    .map((u) => {
      const lista = porUnidade.get(u.id) || [];
      const datas = lista.map((r) => r.data_evento).filter(Boolean).sort();
      return {
        ...u,
        rotulo: labelUnidade(u, 'Unidade'),
        status: statusDaUnidade(lista),
        problemasAbertos: lista.filter((r) => r.tipo === 'problema' && !r.resolvido).length,
        totalRegistros: lista.length,
        ultimoEvento: datas[datas.length - 1] || null,
      };
    })
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR', { numeric: true }));
}

/** Unidades do morador logado neste condomínio. */
export async function unidadesDoMorador(condoId, userId) {
  const { data, error } = await supabase
    .from('unidade_moradores')
    .select('unidades(id, identificacao, bloco, andar, condominio_id)')
    .eq('usuario_id', userId);
  if (error) throw error;
  return (data || [])
    .map((row) => (Array.isArray(row.unidades) ? row.unidades[0] : row.unidades))
    .filter((u) => u?.id && u.condominio_id === condoId)
    .map((u) => ({ ...u, rotulo: labelUnidade(u, 'Unidade') }));
}

export async function carregarUnidade(unidadeId) {
  const { data, error } = await supabase
    .from('unidades')
    .select('id, identificacao, bloco, andar, condominio_id')
    .eq('id', unidadeId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, rotulo: labelUnidade(data, 'Unidade') } : null;
}

/** Linha do tempo completa da unidade: registros, anexos e mensagens dos problemas. */
export async function carregarLinhaTempo(unidadeId) {
  const { data: registros, error } = await supabase
    .from('recebimento_registros')
    .select('*')
    .eq('unidade_id', unidadeId)
    .order('data_evento')
    .order('created_at');
  if (error) throw error;
  const lista = registros || [];
  const ids = lista.map((r) => r.id);
  if (!ids.length) return [];

  const { data: mensagens, error: mErr } = await supabase
    .from('recebimento_mensagens')
    .select('*')
    .in('registro_id', ids)
    .order('created_at');
  if (mErr) throw mErr;
  const msgIds = (mensagens || []).map((m) => m.id);

  const [arqReg, arqMsg] = await Promise.all([
    supabase.from('recebimento_arquivos').select(`registro_id, ordem, arquivos(${CAMPOS_ARQUIVO})`).in('registro_id', ids),
    msgIds.length
      ? supabase.from('recebimento_arquivos').select(`mensagem_id, ordem, arquivos(${CAMPOS_ARQUIVO})`).in('mensagem_id', msgIds)
      : Promise.resolve({ data: [] }),
  ]);

  const agrupar = async (rows, chave) => {
    const mapa = {};
    for (const row of rows || []) {
      const arquivo = Array.isArray(row.arquivos) ? row.arquivos[0] : row.arquivos;
      if (!arquivo) continue;
      (mapa[row[chave]] ||= []).push({ ...arquivo, ordem: row.ordem || 0 });
    }
    await Promise.all(Object.keys(mapa).map(async (k) => {
      mapa[k] = await Promise.all(mapa[k].sort((a, b) => a.ordem - b.ordem).map(comUrl));
    }));
    return mapa;
  };
  const [porRegistro, porMensagem] = await Promise.all([
    agrupar(arqReg.data, 'registro_id'),
    agrupar(arqMsg.data, 'mensagem_id'),
  ]);

  // Nomes de quem escreveu (quando o usuário pode ler a tabela de usuários).
  const autores = [...new Set([
    ...lista.map((r) => r.criado_por),
    ...(mensagens || []).map((m) => m.usuario_id),
  ].filter(Boolean))];
  const nomes = {};
  if (autores.length) {
    const { data: us } = await supabase.from('usuarios').select('id, nome').in('id', autores);
    for (const u of us || []) nomes[u.id] = u.nome;
  }

  const msgsPorRegistro = {};
  for (const m of mensagens || []) {
    (msgsPorRegistro[m.registro_id] ||= []).push({
      ...m,
      autorNome: nomes[m.usuario_id] || '',
      arquivos: porMensagem[m.id] || [],
    });
  }

  return lista.map((r) => ({
    ...r,
    autorNome: nomes[r.criado_por] || '',
    arquivos: porRegistro[r.id] || [],
    mensagens: msgsPorRegistro[r.id] || [],
  }));
}

async function anexar({ condominioId, userId, files, registroId, mensagemId }) {
  const lista = [...(files || [])];
  for (let i = 0; i < lista.length; i += 1) {
    const arquivo = await uploadArquivo({
      condominioId,
      userId,
      file: lista[i],
      folder: 'recebimento',
    });
    const { error } = await supabase.from('recebimento_arquivos').insert({
      condominio_id: condominioId,
      registro_id: registroId || null,
      mensagem_id: mensagemId || null,
      arquivo_id: arquivo.id,
      ordem: i,
    });
    if (error) throw error;
  }
}

export async function criarRegistro({ condominioId, unidadeId, userId, tipo, titulo, descricao, dataEvento, files }) {
  const { data, error } = await supabase
    .from('recebimento_registros')
    .insert({
      condominio_id: condominioId,
      unidade_id: unidadeId,
      tipo,
      titulo: String(titulo || '').trim() || null,
      descricao: String(descricao || '').trim() || null,
      data_evento: dataEvento || new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  if (files?.length) await anexar({ condominioId, userId, files, registroId: data.id });
  return data.id;
}

export async function enviarMensagemRecebimento({ registroId, condominioId, userId, texto, files }) {
  const corpo = String(texto || '').trim();
  if (!corpo && !files?.length) throw new Error('Escreva a mensagem ou anexe um arquivo.');
  const { data, error } = await supabase
    .from('recebimento_mensagens')
    .insert({
      registro_id: registroId,
      condominio_id: condominioId,
      texto: corpo || (files?.length === 1 ? `Arquivo: ${files[0].name}` : 'Arquivos anexados'),
    })
    .select('id')
    .single();
  if (error) throw error;
  if (files?.length) await anexar({ condominioId, userId, files, mensagemId: data.id });
  return data.id;
}

export async function marcarProblemaResolvido(registroId, resolvido) {
  const { error } = await supabase
    .from('recebimento_registros')
    .update({ resolvido })
    .eq('id', registroId);
  if (error) throw error;
}

/** Todos os problemas (chats) de recebimento que a construtora enxerga, em todos os condomínios. */
export async function listarChatsRecebimento() {
  const { data, error } = await supabase
    .from('recebimento_registros')
    .select('id, condominio_id, unidade_id, titulo, descricao, resolvido, data_evento, created_at, unidades(id, identificacao, bloco, andar), condominios(id, nome)')
    .eq('tipo', 'problema')
    .order('data_evento', { ascending: false });
  if (error) throw error;
  const lista = data || [];
  const ids = lista.map((r) => r.id);
  const ultimas = {};
  const contagem = {};
  if (ids.length) {
    const { data: msgs } = await supabase
      .from('recebimento_mensagens')
      .select('registro_id, texto, created_at, autor_papel')
      .in('registro_id', ids)
      .order('created_at');
    for (const m of msgs || []) {
      ultimas[m.registro_id] = m;
      contagem[m.registro_id] = (contagem[m.registro_id] || 0) + 1;
    }
  }
  return lista.map((r) => ({
    ...r,
    unidade: Array.isArray(r.unidades) ? r.unidades[0] : r.unidades,
    condominio: Array.isArray(r.condominios) ? r.condominios[0] : r.condominios,
    rotuloUnidade: labelUnidade(r.unidades, 'Unidade'),
    ultimaMensagem: ultimas[r.id] || null,
    totalMensagens: contagem[r.id] || 0,
  }));
}
