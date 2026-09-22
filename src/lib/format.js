/** Mensagem legível a partir de erro do Supabase/Postgres. */
export function formatDbError(error, contexto = '') {
  if (!error) return 'Erro desconhecido.';
  if (typeof error === 'string') return error;
  const code = error.code || '';
  const raw = String(error.message || error.error_description || 'Erro no banco de dados');
  const prefix = contexto ? `${contexto}: ` : '';

  if (code === '22001' || /value too long|character varying/i.test(raw)) {
    return `${prefix}Algum valor ultrapassou o tamanho máximo permitido no banco.`;
  }
  if (code === '23505' || /duplicate key|unique constraint/i.test(raw)) {
    return `${prefix}Já existe um registro com esses dados (duplicado).`;
  }
  if (code === '23503' || /foreign key/i.test(raw)) {
    return `${prefix}Há uma referência inválida entre registros.`;
  }
  if (code === '42501' || /permission denied|row-level security/i.test(raw)) {
    return `${prefix}Sem permissão para gravar este registro.`;
  }
  return `${prefix}${raw}`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR');
}

function soDigitos(value, max) {
  return String(value || '').replace(/\D/g, '').slice(0, max);
}

/** Mantém CNPJ só com dígitos (até 14). Aceita máscara na entrada. */
export function normalizarCnpj(value) {
  const digits = soDigitos(value, 14);
  return digits || null;
}

/** Máscara 00.000.000/0000-00. */
export function formatCnpj(value) {
  const d = soDigitos(value, 14);
  if (!d) return '';
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  if (d.length <= 2) return p1;
  if (d.length <= 5) return `${p1}.${p2}`;
  if (d.length <= 8) return `${p1}.${p2}.${p3}`;
  if (d.length <= 12) return `${p1}.${p2}.${p3}/${p4}`;
  return `${p1}.${p2}.${p3}/${p4}-${p5}`;
}

/** Máscara (11) 3000-0000 ou (11) 99000-0000. */
export function formatTelefone(value) {
  const d = soDigitos(value, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatChatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function chamadoNumero(n) {
  if (n == null || n === '') return 'ID: —';
  return `ID: ${n}`;
}

/** PostgREST às vezes devolve o embed como array. */
export function embedOne(value) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] || null) : value;
}

export function nomePessoa(value, fallback = '') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  return String(embedOne(value)?.nome || '').trim() || fallback;
}

export function nomeSolicitanteChamado(chamado, { administracao = false, fallback = 'Morador' } = {}) {
  if (administracao) return 'Administração do condomínio';
  return nomePessoa(chamado?.usuarios, fallback);
}

function limparParteUnidade(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function codigoUnidade(texto) {
  return limparParteUnidade(texto)
    .replace(/^(bloco|torre|casa|apt\.?o?|apartamento|unidade|andar)\s+/i, '')
    .toLowerCase();
}

function comPrefixoUnidade(valor, prefixo) {
  const raw = limparParteUnidade(valor);
  if (!raw) return '';
  const resto = raw.replace(/^(bloco|torre|casa|apt\.?o?|apartamento|unidade|andar)\s+/i, '');
  if (/^bloco\b/i.test(raw)) return resto ? `Bloco ${resto}` : 'Bloco';
  if (/^torre\b/i.test(raw)) return resto ? `Torre ${resto}` : 'Torre';
  if (/^casa\b/i.test(raw)) return resto ? `Casa ${resto}` : 'Casa';
  if (/^(apt\.?o?|apartamento)\b/i.test(raw)) return resto ? `Apt ${resto}` : 'Apt';
  if (/^andar\b/i.test(raw)) return resto ? `Andar ${resto}` : 'Andar';
  return `${prefixo} ${raw}`;
}

/** Ex.: "Casa 4 Bloco N", "Apt 101 Bloco A". */
export function labelUnidade(unidade, fallback = '') {
  if (unidade == null || unidade === '') return fallback;
  if (typeof unidade === 'string') return labelUnidade({ identificacao: unidade }, fallback);
  const u = embedOne(unidade);
  if (!u) return fallback;

  const identificacao = limparParteUnidade(u.identificacao || u.nome || '');
  const blocoRaw = limparParteUnidade(u.bloco);
  const andarRaw = limparParteUnidade(u.andar);

  if (identificacao && /(bloco|torre)/i.test(identificacao) && /(casa|apt|apartamento)/i.test(identificacao)) {
    return identificacao.replace(/\s*\/\s*/g, ' ');
  }

  let casa = '';
  let bloco = '';

  if (/^casa\b/i.test(identificacao)) {
    casa = comPrefixoUnidade(identificacao, 'Casa');
  } else if (/^(apt\.?o?|apartamento)\b/i.test(identificacao)) {
    casa = comPrefixoUnidade(identificacao, 'Apt');
  } else if (/^(bloco|torre)\b/i.test(identificacao) && !blocoRaw) {
    bloco = comPrefixoUnidade(identificacao, /torre/i.test(identificacao) ? 'Torre' : 'Bloco');
  } else if (identificacao) {
    if (/^\d{3,}$/.test(identificacao)) casa = `Apt ${identificacao}`;
    else if (/^[0-9A-Za-z-]+$/.test(identificacao)) casa = `Casa ${identificacao}`;
    else casa = identificacao;
  }

  if (blocoRaw) {
    bloco = comPrefixoUnidade(blocoRaw, /torre/i.test(blocoRaw) ? 'Torre' : 'Bloco');
  }

  if (casa && bloco && codigoUnidade(casa) === codigoUnidade(bloco)) {
    bloco = '';
  }

  const andar = andarRaw && !/^0+$/.test(andarRaw)
    ? comPrefixoUnidade(andarRaw, 'Andar')
    : '';
  const parts = [casa, bloco];
  if (andar && codigoUnidade(andar) && !parts.some((p) => codigoUnidade(p) === codigoUnidade(andar))) {
    parts.push(andar);
  }
  return parts.filter(Boolean).join(' ') || fallback;
}

export function rotuloSolicitanteUnidade(chamado, opts = {}) {
  if (opts.administracao) {
    return labelUnidade(chamado?.unidades) || 'Áreas comuns';
  }
  const nome = nomeSolicitanteChamado(chamado, opts);
  const unidade = labelUnidade(chamado?.unidades);
  return unidade ? `${nome} - ${unidade}` : nome;
}

export function laudoNumero(n) {
  return `Laudo #${n}`;
}

export function rotuloLaudoUnidade(laudo) {
  return labelUnidade(
    laudo?.unidades
    || laudo?.chamados?.unidades
    || {
      identificacao: laudo?.unidade_identificacao,
      bloco: laudo?.unidade_bloco,
      andar: laudo?.unidade_andar,
    },
    'Unidade',
  );
}

export function fileKind(mime) {
  if (!mime) return 'outro';
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('video/')) return 'video';
  if (mime.includes('pdf') || mime.includes('word') || mime.includes('text')) return 'documento';
  return 'outro';
}

export function addPeriod(date, periodicidade, customDays) {
  const base = date ? new Date(date) : new Date();
  const map = {
    diaria: 1,
    semanal: 7,
    quinzenal: 15,
    mensal: 30,
    bimestral: 60,
    trimestral: 90,
    semestral: 180,
    anual: 365,
    personalizada: Number(customDays) || 30,
  };
  base.setDate(base.getDate() + (map[periodicidade] || 30));
  return base.toISOString().slice(0, 10);
}

export function maintenanceTone(row) {
  if (!row) return 'em_dia';
  if (!row.ativo) return 'inativa';
  if (!row.proxima_execucao) return 'em_dia';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(row.proxima_execucao);
  const diff = (next - today) / 86400000;
  if (diff < 0) return 'atrasada';
  if (diff <= 7) return 'proxima';
  return 'em_dia';
}
