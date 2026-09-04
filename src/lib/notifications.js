import { supabase } from './supabase';

export async function listarNotificacoes({ condominioId, limit = 40 } = {}) {
  let query = supabase
    .from('notificacoes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (condominioId) query = query.eq('condominio_id', condominioId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function contarNotificacoesNaoLidas({ condominioId } = {}) {
  let query = supabase
    .from('notificacoes')
    .select('id', { count: 'exact', head: true })
    .is('lida_em', null);
  if (condominioId) query = query.eq('condominio_id', condominioId);
  const { count, error } = await query;
  if (error) return 0;
  return count || 0;
}

export async function marcarNotificacaoLida(id) {
  if (!id) return;
  const rpc = await supabase.rpc('marcar_notificacao_lida', { p_id: id });
  if (!rpc.error) return;
  await supabase.from('notificacoes').update({ lida_em: new Date().toISOString() }).eq('id', id);
}

export async function marcarTodasNotificacoesLidas() {
  const rpc = await supabase.rpc('marcar_todas_notificacoes_lidas');
  if (!rpc.error) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('notificacoes')
    .update({ lida_em: new Date().toISOString() })
    .eq('usuario_id', user.id)
    .is('lida_em', null);
}

export async function marcarConversaLida(conversaId) {
  if (!conversaId) return;
  await supabase.rpc('marcar_conversa_lida', { p_conversa_id: conversaId });
}

export async function marcarConversaLidaPorChamado(chamadoId) {
  if (!chamadoId) return;
  await supabase.rpc('marcar_conversa_lida_por_chamado', { p_chamado_id: chamadoId });
}

export async function marcarConversaLidaPorLaudo(laudoId) {
  if (!laudoId) return;
  await supabase.rpc('marcar_conversa_lida_por_laudo', { p_laudo_id: laudoId });
}

/** Map: chamado_id|laudo_id -> { estado, nao_lidas, conversa_id, ultima_leitura_em } */
export async function mapaLeituraConversas() {
  const { data, error } = await supabase.rpc('resumo_leitura_conversas');
  if (error || !data) return { byChamado: {}, byLaudo: {}, byCondo: {} };

  const byChamado = {};
  const byLaudo = {};
  const byCondo = {};

  for (const row of data) {
    const info = {
      estado: row.estado || 'lida',
      nao_lidas: row.nao_lidas || 0,
      conversa_id: row.conversa_id,
    };
    if (row.chamado_id) byChamado[row.chamado_id] = info;
    if (row.laudo_id) byLaudo[row.laudo_id] = info;
    if (row.condominio_id && (info.estado === 'nova' || info.estado === 'nao_lida')) {
      byCondo[row.condominio_id] = (byCondo[row.condominio_id] || 0) + 1;
    }
  }
  return { byChamado, byLaudo, byCondo };
}

export async function condominiosComNaoLidas() {
  const { data, error } = await supabase.rpc('condominios_com_conversas_nao_lidas');
  if (error || !data) {
    const map = await mapaLeituraConversas();
    return map.byCondo;
  }
  const byCondo = {};
  for (const row of data) {
    if (row.condominio_id) byCondo[row.condominio_id] = row.total || 0;
  }
  return byCondo;
}

export function classeListaConversa(estado) {
  if (estado === 'nova') return 'chat-item--nova';
  if (estado === 'nao_lida') return 'chat-item--nao-lida';
  return '';
}

export function mensagemEhNova(mensagem, userId, lidaAte) {
  if (!mensagem || mensagem.usuario_id === userId) return false;
  if (mensagem.excluido_em) return false;
  if (!lidaAte) return true;
  return new Date(mensagem.created_at) > new Date(lidaAte);
}

export const NOTIF_TIPO_LABEL = {
  mensagem: 'Conversa',
  boletim: 'Boletim',
  status_chamado: 'Chamado',
};

/** Navega para o destino da notificação (marca condo se necessário). */
export async function destinoNotificacao(row, { selectCondo, navigate, isGestaoTecnica }) {
  if (row.tipo === 'boletim') {
    if (row.condominio_id) selectCondo(row.condominio_id);
    navigate('/boletins');
    return;
  }
  if (row.tipo === 'status_chamado' && row.ref_id) {
    if (row.condominio_id) selectCondo(row.condominio_id);
    navigate(`/chamados/${row.ref_id}`);
    return;
  }
  if (row.tipo === 'mensagem') {
    let chamadoId = null;
    let laudoId = null;
    let condo = row.condominio_id;
    if (row.ref_tipo === 'conversa' && row.ref_id) {
      const { data } = await supabase
        .from('conversas')
        .select('chamado_id, laudo_id, condominio_id')
        .eq('id', row.ref_id)
        .maybeSingle();
      chamadoId = data?.chamado_id || null;
      laudoId = data?.laudo_id || null;
      condo = data?.condominio_id || condo;
    } else if (row.ref_tipo === 'chamado') {
      chamadoId = row.ref_id;
    } else if (row.ref_tipo === 'laudo') {
      laudoId = row.ref_id;
    }

    if (condo) selectCondo(condo);

    if (laudoId) {
      navigate(isGestaoTecnica ? `/laudos-globais/${laudoId}` : `/laudos/${laudoId}`);
      return;
    }
    if (chamadoId) {
      navigate(isGestaoTecnica ? `/suporte/${chamadoId}` : `/chamados/${chamadoId}`);
      return;
    }
    navigate(isGestaoTecnica ? '/suporte' : '/chamados');
  }
}
