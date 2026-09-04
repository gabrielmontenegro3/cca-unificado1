import { can, STATUS_LABEL } from './permissions';

export const TIPO_INSPECAO_AGENDADA = 'inspecao_agendada';

export const RASTREABILIDADE_TIPOS = {
  atendimento: 'Atendimento',
  inspecao: 'Inspeção',
  inspecao_agendada: 'Visita agendada',
  apontamento: 'Apontamento / diagnóstico',
  repasse_construtora: 'Repasse à construtora',
  repasse_administracao: 'Repasse à administração',
  atualizacao_cliente: 'Atualização do cliente',
  comunicado_construtora: 'Comunicação com construtora',
  acao_construtora: 'Ação da construtora',
};

export const RASTREABILIDADE_ICON = {
  atendimento: 'user',
  inspecao: 'search',
  inspecao_agendada: 'calendar',
  apontamento: 'clipboard',
  repasse_construtora: 'building',
  repasse_administracao: 'building',
  atualizacao_cliente: 'message',
  comunicado_construtora: 'mail',
  acao_construtora: 'wrench',
};

export function tiposRastreabilidadePermitidos(cargoTipo) {
  if (!can(cargoTipo, 'manage_traceability')) return [];
  return Object.keys(RASTREABILIDADE_TIPOS).filter((tipo) => tipo !== TIPO_INSPECAO_AGENDADA);
}

export function labelRastreabilidade(tipo) {
  return RASTREABILIDADE_TIPOS[tipo] || tipo || 'Registro';
}

export function tipoLabelEvento(item) {
  if (!item) return 'Registro';
  if (item.tipo === 'abertura') return 'Abertura';
  if (item.tipo === 'status') return 'Status';
  if (eventoEhInspecaoAgendada(item)) return 'Visita agendada';
  return labelRastreabilidade(item.tipo);
}

export function formatYmdBr(ymd) {
  const match = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatHorarioHm(horario) {
  const match = String(horario || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
}

export function tituloInspecaoAgendada(dataYmd, horario) {
  const dataLabel = formatYmdBr(dataYmd);
  const hora = formatHorarioHm(horario);
  if (!dataLabel) return 'Visita agendada';
  if (hora) return `Visita agendada, data: ${dataLabel} às ${hora}`;
  return `Visita agendada, data: ${dataLabel}`;
}

export function mensagemChatVisita(dataYmd, horario) {
  const dataLabel = formatYmdBr(dataYmd);
  const hora = formatHorarioHm(horario);
  if (!dataLabel) return 'Visita agendada.';
  if (hora) return `Visita agendada para ${dataLabel} às ${hora}.`;
  return `Visita agendada para ${dataLabel}.`;
}

export function isoAgendamento(dataYmd, horario) {
  const ymd = String(dataYmd || '').slice(0, 10);
  const hora = formatHorarioHm(horario);
  const local = hora ? `${ymd}T${hora}:00` : `${ymd}T00:00:00`;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function eventoEhInspecaoAgendada(evento) {
  if (!evento) return false;
  if (evento.tipo === TIPO_INSPECAO_AGENDADA) return true;
  return /^(inspe[cç][aã]o|visita) agendada/i.test(String(evento.titulo || ''));
}

export function horarioDoEvento(evento) {
  const fromTitle = String(evento?.titulo || evento?.descricao || '').match(/às\s+(\d{1,2}:\d{2})/i);
  if (fromTitle) return formatHorarioHm(fromTitle[1]);
  const when = evento?.data_ocorrencia;
  if (!when) return '';
  const date = new Date(when);
  if (Number.isNaN(date.getTime())) return '';
  if (date.getHours() === 0 && date.getMinutes() === 0) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function proximaVisitaAgendada(eventos) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return (eventos || [])
    .filter((evento) => {
      const when = new Date(evento.data_ocorrencia || evento.created_at);
      if (Number.isNaN(when.getTime())) return false;
      const day = new Date(when);
      day.setHours(0, 0, 0, 0);
      return day.getTime() >= hoje.getTime();
    })
    .sort((a, b) => {
      const ta = new Date(a.data_ocorrencia || a.created_at).getTime();
      const tb = new Date(b.data_ocorrencia || b.created_at).getTime();
      return ta - tb;
    })[0] || null;
}

export function visitaAgendadaDeMensagens(mensagens) {
  const re = /(inspe[cç][aã]o|visita) agendada para (\d{1,2}\/\d{1,2}\/\d{4})(?: às (\d{1,2}:\d{2}))?/i;
  const encontrados = [];
  for (const mensagem of mensagens || []) {
    const match = String(mensagem.texto || '').match(re);
    if (!match) continue;
    const [dia, mes, ano] = match[2].split('/');
    const ymd = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const hora = match[3] || '';
    encontrados.push({
      id: `msg-${mensagem.id}`,
      tipo: TIPO_INSPECAO_AGENDADA,
      titulo: tituloInspecaoAgendada(ymd, hora),
      descricao: String(mensagem.texto || '').trim(),
      data_ocorrencia: isoAgendamento(ymd, hora),
      created_at: mensagem.created_at,
    });
  }
  return proximaVisitaAgendada(encontrados);
}

export function tituloRastreabilidade(evento) {
  if (!evento) return 'Registro';
  if (evento.titulo) return evento.titulo;
  if (evento.tipo === TIPO_INSPECAO_AGENDADA) return 'Visita agendada';
  if (evento.tipo === 'inspecao' && evento.numero_inspecao) {
    return `${evento.numero_inspecao}ª inspeção`;
  }
  return labelRastreabilidade(evento.tipo);
}

export function buildTimeline(chamado, fotosAbertura, registros, historico) {
  const items = [];

  items.push({
    id: 'abertura',
    kind: 'sistema',
    tipo: 'abertura',
    titulo: 'Chamado aberto',
    descricao: chamado?.descricao,
    when: chamado?.created_at,
    registrado: chamado?.usuarios,
    arquivos: fotosAbertura,
  });

  for (const h of historico || []) {
    items.push({
      id: `status-${h.id}`,
      kind: 'status',
      tipo: 'status',
      titulo: STATUS_LABEL[h.status_novo] || h.status_novo,
      observacao: h.observacao,
      when: h.created_at,
      usuarios: h.usuarios,
    });
  }

  const inspecoes = (registros || []).filter((r) => r.tipo === 'inspecao');
  const apontamentos = (registros || []).filter((r) => r.tipo === 'apontamento');

  for (const reg of registros || []) {
    if (reg.tipo === 'apontamento') continue;
    const children = reg.tipo === 'inspecao'
      ? apontamentos.filter((a) => a.parent_id === reg.id)
      : [];
    items.push({
      ...reg,
      kind: 'registro',
      when: reg.data_ocorrencia || reg.created_at,
      children,
    });
  }

  for (const ap of apontamentos) {
    if (!ap.parent_id || !inspecoes.some((i) => i.id === ap.parent_id)) {
      items.push({
        ...ap,
        kind: 'registro',
        when: ap.data_ocorrencia || ap.created_at,
      });
    }
  }

  const abertura = items[0];
  const rest = items.slice(1).sort((a, b) => new Date(a.when) - new Date(b.when));
  return [abertura, ...rest];
}
