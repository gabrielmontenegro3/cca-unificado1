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

export const CARGO_LABEL = {
  administrador: 'Administrador',
  gestao_tecnica: 'Gestão Técnica',
  construtora: 'Construtora',
  administracao: 'Administração',
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
    view_all_tickets: isStaff(t),
    create_ticket: t === 'morador',
    view_maintenance: isStaff(t) || isGestao(t),
    manage_boletins: t === 'administrador' || t === 'gestao_tecnica',
  };
  return Boolean(map[action]);
}

export function navFor(tipo) {
  return navGroupsFor(tipo).flatMap((group) => group.items);
}

export function navGroupsFor(tipo) {
  const isGT = String(tipo || '').toLowerCase().trim() === 'gestao_tecnica';
  const groups = [
    {
      id: 'empreendimento',
      label: 'Empreendimento',
      icon: 'building',
      items: [
        { to: '/visao-geral', label: 'Visão geral', icon: 'home' },
        { to: '/empreendimento', label: 'Empreendimento', icon: 'building' },
        { to: '/documentos', label: 'Documentos', icon: 'folder' },
        { to: '/boletins', label: 'Boletins informativos', icon: 'newspaper' },
      ],
    },
    {
      id: 'manutencao',
      label: 'Manutenção',
      icon: 'wrench',
      items: [
        { to: '/manutencao', label: 'Manutenções', icon: 'wrench' },
        ...(isGT ? [{ to: '/suporte', label: 'Suporte', icon: 'headset' }] : []),
        ...(isGT ? [{ to: '/rastreabilidade', label: 'Rastreabilidade', icon: 'layers' }] : []),
        ...(isGT ? [{ to: '/agendar-visita', label: 'Agendar visita', icon: 'calendar' }] : []),
        ...(isGT ? [{ to: '/relatorio', label: 'Relatório', icon: 'file' }] : []),
        ...(isGT ? [{ to: '/laudos', label: 'Laudos técnicos', icon: 'clipboard' }] : []),
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
