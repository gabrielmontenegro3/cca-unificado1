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
  const t = String(tipo || '').toLowerCase().trim();
  if (t === 'morador') {
    return [
      { to: '/chamados', label: 'Meus Chamados' },
      { to: '/visao-geral', label: 'Visão Geral' },
      { to: '/empreendimento', label: 'Sobre o Empreendimento' },
      { to: '/documentos', label: 'Documentos' },
      { to: '/boletins', label: 'Boletins' },
      { to: '/contatos', label: 'Contatos' },
      { to: '/sobre-nos', label: 'Sobre nós' },
      { to: '/fornecedores', label: 'Fornecedores' },
      { to: '/materiais', label: 'Materiais' },
      { to: '/locais', label: 'Locais' },
      { to: '/garantias', label: 'Garantias' },
      { to: '/manutencao', label: 'Manutenção' },
    ];
  }
  if (t === 'construtora') {
    return [
      { to: '/chamados', label: 'Chamados' },
      { to: '/visao-geral', label: 'Visão Geral' },
      { to: '/empreendimento', label: 'Empreendimento' },
      { to: '/documentos', label: 'Documentos' },
      { to: '/contatos', label: 'Contatos' },
      { to: '/sobre-nos', label: 'Sobre nós' },
      { to: '/fornecedores', label: 'Fornecedores' },
      { to: '/materiais', label: 'Materiais' },
      { to: '/locais', label: 'Locais' },
      { to: '/garantias', label: 'Garantias' },
      { to: '/manutencao', label: 'Manutenção' },
      { to: '/laudos', label: 'Laudos' },
    ];
  }
  if (t === 'gestao_tecnica') {
    return [
      { to: '/', label: 'Condomínios' },
      { to: '/suporte', label: 'Suporte' },
      { to: '/painel', label: 'Dashboard' },
      { to: '/chamados', label: 'Chamados' },
      { to: '/laudos', label: 'Laudos Técnicos' },
      { to: '/manutencao', label: 'Manutenção' },
      { to: '/fornecedores', label: 'Fornecedores' },
      { to: '/materiais', label: 'Materiais' },
      { to: '/locais', label: 'Locais' },
      { to: '/garantias', label: 'Garantias' },
      { to: '/documentos', label: 'Documentos' },
      { to: '/boletins', label: 'Boletins' },
      { to: '/visao-geral', label: 'Visão Geral' },
      { to: '/empreendimento', label: 'Empreendimento' },
      { to: '/usuarios', label: 'Usuários' },
    ];
  }
  if (t === 'administracao') {
    return [
      { to: '/', label: 'Dashboard' },
      { to: '/visao-geral', label: 'Visão Geral' },
      { to: '/empreendimento', label: 'Empreendimento' },
      { to: '/documentos', label: 'Documentos' },
      { to: '/boletins', label: 'Boletins' },
      { to: '/contatos', label: 'Contatos' },
      { to: '/sobre-nos', label: 'Sobre nós' },
      { to: '/fornecedores', label: 'Fornecedores' },
      { to: '/materiais', label: 'Materiais' },
      { to: '/locais', label: 'Locais' },
      { to: '/garantias', label: 'Garantias' },
      { to: '/manutencao', label: 'Manutenção' },
      { to: '/chamados', label: 'Chamados' },
      { to: '/laudos', label: 'Laudos' },
    ];
  }
  return [
    { to: '/', label: 'Dashboard' },
    { to: '/visao-geral', label: 'Visão Geral' },
    { to: '/empreendimento', label: 'Empreendimento' },
    { to: '/documentos', label: 'Documentos' },
    { to: '/boletins', label: 'Boletins' },
    { to: '/contatos', label: 'Contatos' },
    { to: '/sobre-nos', label: 'Sobre nós' },
    { to: '/fornecedores', label: 'Fornecedores' },
    { to: '/materiais', label: 'Materiais' },
    { to: '/locais', label: 'Locais' },
    { to: '/garantias', label: 'Garantias' },
    { to: '/manutencao', label: 'Manutenção' },
    { to: '/chamados', label: 'Chamados' },
    { to: '/laudos', label: 'Laudos Técnicos' },
    { to: '/usuarios', label: 'Usuários' },
  ];
}
