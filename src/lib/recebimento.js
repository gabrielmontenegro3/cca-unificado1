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

/* ===================== Recebimento em chat (um chat por unidade) ===================== */

export const SQL_RECEBIMENTO_CHAT = 'supabase/recebimento-chat.sql';

/** Situação de cada unidade na lista: sem vistoria, com chat (azul) ou OK (verde). */
export const STATUS_CHAT = {
  sem_vistoria: { label: 'Sem vistoria' },
  chat: { label: 'Em andamento' },
  ok: { label: 'OK' },
};

export function mensagemErroRecebimentoChat(err) {
  const msg = String(err?.message || err || '');
  if (/recebimento_mensagens\.unidade_id|unidade_id|Informe a unidade do chat|registro_id.*null|23502/i.test(msg)) {
    return `Rode o arquivo ${SQL_RECEBIMENTO_CHAT} no SQL Editor do Supabase e tente de novo.`;
  }
  return mensagemErroRecebimento(err);
}

function statusChatDe(registros, totalMensagens) {
  if ((registros || []).some((r) => r.tipo === 'assinatura_entrega')) return 'ok';
  if (totalMensagens > 0 || (registros || []).length) return 'chat';
  return 'sem_vistoria';
}

function previewMensagem(m) {
  if (!m) return '';
  const papel = PAPEL_LABEL[m.autor_papel] || '';
  return `${papel ? `${papel}: ` : ''}${m.texto || 'Anexo'}`;
}

/** Unidades do condomínio com a situação do chat de cada uma. */
export async function listarChatsUnidades(condoId, { somenteIds = null } = {}) {
  let unidadesQuery = supabase.from('unidades').select('id, identificacao, bloco, andar').eq('condominio_id', condoId);
  if (somenteIds) unidadesQuery = unidadesQuery.in('id', somenteIds.length ? somenteIds : ['00000000-0000-0000-0000-000000000000']);
  const [unidades, registros, mensagens] = await Promise.all([
    unidadesQuery,
    supabase.from('recebimento_registros').select('id, unidade_id, tipo, titulo, data_evento').eq('condominio_id', condoId),
    supabase.from('recebimento_mensagens').select('id, unidade_id, texto, autor_papel, created_at').eq('condominio_id', condoId).order('created_at'),
  ]);
  if (unidades.error) throw unidades.error;
  if (registros.error) throw registros.error;
  if (mensagens.error) throw mensagens.error;
  const regs = {};
  for (const r of registros.data || []) (regs[r.unidade_id] ||= []).push(r);
  const msgs = {};
  for (const m of mensagens.data || []) (msgs[m.unidade_id] ||= []).push(m);
  return (unidades.data || [])
    .map((u) => {
      const lista = msgs[u.id] || [];
      const ultima = lista[lista.length - 1] || null;
      const eventos = regs[u.id] || [];
      const agendada = eventos.filter((r) => r.tipo === 'vistoria_agendada').sort((a, b) => String(b.data_evento).localeCompare(String(a.data_evento)))[0];
      return {
        ...u,
        rotulo: labelUnidade(u, 'Unidade'),
        status: statusChatDe(eventos, lista.length),
        totalMensagens: lista.length,
        preview: ultima ? previewMensagem(ultima) : agendada ? `Vistoria: ${agendada.titulo || 'agendada'}` : '',
        ultimaAtividade: [ultima?.created_at, ...eventos.map((r) => r.data_evento)].filter(Boolean).sort().pop() || null,
      };
    })
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR', { numeric: true }));
}

/** Chat de uma unidade: mensagens (com anexos) e eventos (vistoria agendada, OK), em ordem. */
export async function carregarChatUnidade(unidadeId) {
  const [mensagens, registros] = await Promise.all([
    supabase.from('recebimento_mensagens').select('*').eq('unidade_id', unidadeId).order('created_at'),
    supabase.from('recebimento_registros').select('*').eq('unidade_id', unidadeId).order('data_evento'),
  ]);
  if (mensagens.error) throw mensagens.error;
  if (registros.error) throw registros.error;
  const msgs = mensagens.data || [];
  const msgIds = msgs.map((m) => m.id);
  const arquivos = msgIds.length
    ? await supabase.from('recebimento_arquivos').select(`mensagem_id, ordem, arquivos(${CAMPOS_ARQUIVO})`).in('mensagem_id', msgIds)
    : { data: [] };
  const porMensagem = {};
  for (const row of arquivos.data || []) {
    const arquivo = Array.isArray(row.arquivos) ? row.arquivos[0] : row.arquivos;
    if (arquivo) (porMensagem[row.mensagem_id] ||= []).push({ ...arquivo, ordem: row.ordem || 0 });
  }
  await Promise.all(Object.keys(porMensagem).map(async (k) => {
    porMensagem[k] = await Promise.all(porMensagem[k].sort((a, b) => a.ordem - b.ordem).map(comUrl));
  }));
  const autores = [...new Set([...msgs.map((m) => m.usuario_id), ...(registros.data || []).map((r) => r.criado_por)].filter(Boolean))];
  const nomes = {};
  if (autores.length) {
    const { data: us } = await supabase.from('usuarios').select('id, nome').in('id', autores);
    for (const u of us || []) nomes[u.id] = u.nome;
  }
  const itens = [
    ...msgs.map((m) => ({
      kind: 'msg',
      id: m.id,
      at: m.created_at,
      mensagem: {
        ...m,
        usuarios: { nome: [nomes[m.usuario_id], PAPEL_LABEL[m.autor_papel]].filter(Boolean).join(' · ') || PAPEL_LABEL[m.autor_papel] || 'Equipe' },
        anexos: porMensagem[m.id] || [],
      },
    })),
    ...(registros.data || []).map((r) => ({
      kind: 'evento',
      id: r.id,
      at: r.tipo === 'vistoria_agendada' ? r.created_at : r.data_evento,
      registro: { ...r, autorNome: nomes[r.criado_por] || '' },
    })),
  ];
  return itens.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export async function enviarMensagemUnidade({ unidadeId, condominioId, userId, texto, files }) {
  const corpo = String(texto || '').trim();
  if (!corpo && !files?.length) throw new Error('Escreva a mensagem ou anexe um arquivo.');
  const { data, error } = await supabase
    .from('recebimento_mensagens')
    .insert({
      unidade_id: unidadeId,
      condominio_id: condominioId,
      texto: corpo || (files?.length === 1 ? `Arquivo: ${files[0].name}` : 'Arquivos anexados'),
    })
    .select('id')
    .single();
  if (error) throw error;
  if (files?.length) await anexar({ condominioId, userId, files, mensagemId: data.id });
  return data.id;
}

export function agendarVistoriaUnidade({ condominioId, unidadeId, userId, titulo, dataEvento }) {
  return criarRegistro({ condominioId, unidadeId, userId, tipo: 'vistoria_agendada', titulo, dataEvento });
}

export function marcarUnidadeOk({ condominioId, unidadeId, userId }) {
  return criarRegistro({ condominioId, unidadeId, userId, tipo: 'assinatura_entrega', titulo: 'Entrega OK' });
}

export async function desmarcarUnidadeOk(unidadeId) {
  const { error } = await supabase.from('recebimento_registros').delete().eq('unidade_id', unidadeId).eq('tipo', 'assinatura_entrega');
  if (error) throw error;
}

/** Construtora: chats de recebimento com atividade, de todos os condomínios. */
export async function listarChatsRecebimentoGlobal() {
  const [registros, mensagens] = await Promise.all([
    supabase.from('recebimento_registros').select('unidade_id, condominio_id, tipo, titulo, data_evento, unidades(id, identificacao, bloco, andar), condominios(id, nome)'),
    supabase.from('recebimento_mensagens').select('unidade_id, condominio_id, texto, autor_papel, created_at, unidades(id, identificacao, bloco, andar), condominios(id, nome)').order('created_at'),
  ]);
  if (registros.error) throw registros.error;
  if (mensagens.error) throw mensagens.error;
  const porUnidade = new Map();
  const garantir = (row) => {
    if (!row.unidade_id) return null;
    if (!porUnidade.has(row.unidade_id)) {
      const unidade = Array.isArray(row.unidades) ? row.unidades[0] : row.unidades;
      const condominio = Array.isArray(row.condominios) ? row.condominios[0] : row.condominios;
      porUnidade.set(row.unidade_id, {
        unidadeId: row.unidade_id,
        condominioId: row.condominio_id,
        rotulo: labelUnidade(unidade, 'Unidade'),
        condominio: condominio?.nome || 'Condomínio',
        registros: [],
        mensagens: [],
      });
    }
    return porUnidade.get(row.unidade_id);
  };
  for (const r of registros.data || []) garantir(r)?.registros.push(r);
  for (const m of mensagens.data || []) garantir(m)?.mensagens.push(m);
  return [...porUnidade.values()].map((c) => {
    const ultima = c.mensagens[c.mensagens.length - 1] || null;
    return {
      ...c,
      status: statusChatDe(c.registros, c.mensagens.length),
      preview: ultima ? previewMensagem(ultima) : '',
      ultimaAtividade: [ultima?.created_at, ...c.registros.map((r) => r.data_evento)].filter(Boolean).sort().pop() || null,
    };
  }).sort((a, b) => String(b.ultimaAtividade).localeCompare(String(a.ultimaAtividade)));
}
