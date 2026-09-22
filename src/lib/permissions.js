export const STATUS_CHAMADO = [
  'aberto',
  'em_analise',
  'aguardando_morador',
  'aguardando_fornecedor',
  'em_execucao',
  'resolvido',
  'encerrado',
  'cancelado',
];

export const STATUS_LABEL = {
  aberto: 'Aberto',
  em_analise: 'Em análise',
  aguardando_morador: 'Aguardando morador',
  aguardando_fornecedor: 'Aguardando fornecedor',
  em_execucao: 'Em execução',
  resolvido: 'Resolvido',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
};

export const STATUS_UI = [
  { id: 'aberto', label: 'Aberto', match: ['aberto'] },
  { id: 'em_execucao', label: 'Em andamento', match: ['em_analise', 'aguardando_morador', 'aguardando_fornecedor', 'em_execucao'] },
  { id: 'resolvido', label: 'Concluído', match: ['resolvido'] },
  { id: 'encerrado', label: 'Encerrado', match: ['encerrado', 'cancelado'] },
];

export function statusUi(value) {
  return STATUS_UI.find((item) => item.match.includes(value)) || STATUS_UI[0];
}

export const CRITICIDADE_LAUDO = [
  { id: 'baixa', label: 'Baixa' },
  { id: 'media', label: 'Média' },
  { id: 'alta', label: 'Alta' },
  { id: 'critica', label: 'Crítica' },
];

export const CRITICIDADE_LABEL = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
};

export const CARGO_LABEL = {
  administrador: 'Administrador',
  admin_sistema: 'Administrador do sistema',
  gestao_tecnica: 'Gestão Técnica',
  construtora: 'Construtora',
  administracao: 'Administração do condomínio',
  morador: 'Morador',
};

export const TIPO_LOCAL = {
  area_comum: 'Área comum',
  unidade: 'Unidade',
  fachada: 'Fachada',
  cobertura: 'Cobertura',
  garagem: 'Garagem',
  area_tecnica: 'Área técnica',
  outro: 'Outro',
};

export const AREA_LOCAL = {
  privativa: 'Área privativa',
  comum: 'Área comum',
};

export const PERIODICIDADE = {
  diaria: { label: 'Diária', days: 1 },
  semanal: { label: 'Semanal', days: 7 },
  quinzenal: { label: 'Quinzenal', days: 15 },
  mensal: { label: 'Mensal', days: 30 },
  bimestral: { label: 'Bimestral', days: 60 },
  trimestral: { label: 'Trimestral', days: 90 },
  semestral: { label: 'Semestral', days: 180 },
  anual: { label: 'Anual', days: 365 },
  personalizada: { label: 'Personalizada', days: null },
};

const STAFF = new Set(['administrador', 'gestao_tecnica', 'administracao']);
const GESTAO = new Set(['administrador', 'gestao_tecnica']);

export function isStaff(tipo) {
  return STAFF.has(String(tipo || '').toLowerCase().trim());
}

export function isGestao(tipo) {
  return GESTAO.has(String(tipo || '').toLowerCase().trim());
}

export const UNIDADE_AREAS_COMUNS = 'Áreas comuns';
export const ORIGEM_ADMINISTRACAO = 'administracao';

export function ehCargoAdministracao(tipo) {
  return String(tipo || '').toLowerCase().trim() === 'administracao';
}

export function ehCargoConstrutora(tipo) {
  return String(tipo || '').toLowerCase().trim() === 'construtora';
}

export function nomeUnidadeNormalizado(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function ehUnidadeAreasComuns(value) {
  const raw = typeof value === 'string' ? value : (value?.identificacao || '');
  const n = nomeUnidadeNormalizado(raw);
  return n === 'areas comuns' || n === 'area comum';
}

export function ehChamadoAdministracao(row) {
  if (!row) return false;
  if (String(row.origem || '').toLowerCase() === ORIGEM_ADMINISTRACAO) return true;
  return ehUnidadeAreasComuns(row.unidades || row.unidade);
}

export function aplicarEscopoChamados(query, cargoTipo, userId) {
  if (ehCargoAdministracao(cargoTipo)) {
    return query.eq('origem', ORIGEM_ADMINISTRACAO);
  }
  if (!can(cargoTipo, 'view_all_tickets')) {
    return query.eq('solicitante_id', userId);
  }
  return query;
}

export function can(tipo, action) {
  const t = String(tipo || '').toLowerCase().trim();
  const map = {
    dashboard_ops: isStaff(t),
    manage_content: isStaff(t),
    manage_catalog: t === 'gestao_tecnica' || t === 'administrador',
    technical_base: isGestao(t) || t === 'administracao',
    create_condo: t === 'gestao_tecnica',
    manage_users: t === 'administrador' || t === 'gestao_tecnica',
    change_status: isGestao(t),
    manage_traceability: t === 'gestao_tecnica',
    create_laudo: t === 'gestao_tecnica',
    view_laudos: t !== 'morador',
    chat_laudo: t === 'gestao_tecnica' || t === 'construtora',
    view_all_tickets: isGestao(t),
    view_admin_tickets: t === 'administracao',
    create_ticket: t === 'morador' || t === 'administracao',
    view_maintenance: isStaff(t) || isGestao(t) || t === 'construtora',
    view_chamado_numeros: isStaff(t) || t === 'construtora',
    manage_boletins: t === 'administrador' || t === 'gestao_tecnica',
  };
  return Boolean(map[action]);
}

export function navFor(tipo) {
  return navGroupsFor(tipo).flatMap((group) => group.items);
}

export function navGroupsFor(tipo) {
  const t = String(tipo || '').toLowerCase().trim();
  const isGT = t === 'gestao_tecnica';
  const isMorador = t === 'morador';
  const isAdminCondo = t === 'administracao';
  const isConstrutora = t === 'construtora';

  if (isConstrutora) {
    return [
      {
        id: 'governanca',
        label: 'Governança',
        icon: 'clipboard',
        items: [
          { to: '/governanca-tecnica', label: 'Governança técnica', icon: 'clipboard' },
        ],
      },
      {
        id: 'operacao',
        label: 'Operação',
        icon: 'home',
        items: [
          { to: '/visao-geral', label: 'Números dos chamados', icon: 'home' },
          { to: '/manutencao', label: 'Manutenções', icon: 'wrench' },
        ],
      },
    ];
  }
  const groups = [
    {
      id: 'empreendimento',
      label: 'Empreendimento',
      icon: 'building',
      items: [
        { to: '/visao-geral', label: 'Visão geral', icon: 'home' },
        ...(isMorador ? [{ to: '/assistencia-tecnica', label: 'Assistência técnica', icon: 'headset' }] : []),
        ...(isAdminCondo ? [{ to: '/chamados', label: 'Chamados', icon: 'headset' }] : []),
        { to: '/documentos', label: 'Documentos', icon: 'folder' },
        { to: '/meu-imovel', label: 'Meu imóvel', icon: 'door' },
        { to: '/boletins', label: 'Boletins informativos', icon: 'newspaper' },
      ],
    },
    {
      id: 'manutencao',
      label: 'Manutenção',
      icon: 'wrench',
      items: [
        { to: '/manutencao', label: 'Manutenções', icon: 'wrench' },
        ...(isGT ? [{ to: '/chamados', label: 'Chamados', icon: 'message' }] : []),
        ...(isGT ? [{ to: '/suporte', label: 'Suporte global', icon: 'headset' }] : []),
        ...(isGT ? [{ to: '/rastreabilidade', label: 'Rastreabilidade', icon: 'layers' }] : []),
        ...(isGT ? [{ to: '/agendar-visita', label: 'Agendar visita', icon: 'calendar' }] : []),
        ...(isGT ? [{ to: '/relatorio', label: 'Relatório', icon: 'file' }] : []),
        ...(isGT ? [{ to: '/governanca-tecnica', label: 'Governança técnica', icon: 'clipboard' }] : []),
      ],
    },
    {
      id: 'materiais',
      label: 'Materiais',
      icon: 'layers',
      items: [
        { to: '/fornecedores', label: 'Fornecedores', icon: 'box' },
        { to: '/materiais', label: 'Materiais', icon: 'layers' },
        { to: '/garantias', label: 'Garantias', icon: 'shield' },
        { to: '/locais', label: 'Locais', icon: 'map' },
      ],
    },
    {
      id: 'sistema',
      label: 'Sistema',
      icon: 'layout',
      items: [
        ...(isGT ? [{ to: '/usuarios', label: 'Usuários', icon: 'users' }] : []),
      ],
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}
