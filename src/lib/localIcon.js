/** Interpreta o nome/descrição de um local e devolve ícone + tipo. */

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesKey(text, key) {
  const needle = fold(key);
  if (!needle || !text) return false;
  if (needle.includes(' ')) return text.includes(needle);
  return text.split(' ').some((token) => (
    token === needle
    || token === `${needle}s`
    || token === `${needle}es`
    || token.startsWith(`${needle}s`) && token.length <= needle.length + 3
  ));
}

/**
 * Regras mais específicas primeiro. `tipo` respeita o enum do banco:
 * area_comum | unidade | fachada | cobertura | garagem | area_tecnica | outro
 */
const RULES = [
  { icon: 'pool', tipo: 'area_comum', keys: ['piscina infantil', 'piscina', 'pool', 'natacao', 'nado', 'raia', 'aquatico', 'espelho d agua'] },
  { icon: 'dumbbell', tipo: 'area_comum', keys: ['academia', 'fitness', 'musculacao', 'ginastica', 'gym', 'peso', 'sala de ginastica', 'pilates', 'yoga'] },
  { icon: 'car', tipo: 'garagem', keys: ['estacionamento', 'garagem', 'garage', 'subsolo de garagem', 'vaga coberta', 'vagas', 'vaga', 'portao de veiculos', 'cancela', 'entrada de veiculos', 'acesso de veiculos'] },
  { icon: 'elevator', tipo: 'area_comum', keys: ['elevador', 'elevadores', 'monta carga'] },
  { icon: 'stairs', tipo: 'area_comum', keys: ['escadaria', 'escada', 'lance de'] },
  { icon: 'flame', tipo: 'area_comum', keys: ['churrasqueira', 'churrasco', 'barbecue', 'grill'] },
  { icon: 'utensils', tipo: 'area_comum', keys: ['espaco gourmet', 'area gourmet', 'cozinha gourmet', 'gourmet', 'cozinha', 'refeitorio', 'restaurante'] },
  { icon: 'slide', tipo: 'area_comum', keys: ['salao de jogos', 'sala de jogos'] },
  { icon: 'wine', tipo: 'area_comum', keys: ['salao de festas', 'salao de festa', 'salao', 'festas', 'festa', 'eventos'] },
  { icon: 'paw', tipo: 'area_comum', keys: ['pet place', 'petplace', 'pet', 'pets', 'caes', 'cachorro', 'dog'] },
  { icon: 'court', tipo: 'area_comum', keys: ['quadra', 'poliesportiva', 'esportes', 'esporte', 'tenis', 'futebol', 'beach tennis', 'sports'] },
  { icon: 'slide', tipo: 'area_comum', keys: ['brinquedoteca', 'playground', 'parquinho', 'play ground', 'espaco kids', 'kids', 'infantil', 'sinuca', 'games', 'game', 'play'] },
  { icon: 'tree', tipo: 'area_comum', keys: ['jardim', 'jardins', 'paisagismo', 'gramado', 'area verde', 'pomar', 'horta', 'bosque', 'praca', 'patio', 'atrio'] },
  { icon: 'sun', tipo: 'cobertura', keys: ['terraco', 'rooftop', 'solarium', 'solario', 'deck', 'sacada', 'varanda'] },
  { icon: 'roof', tipo: 'cobertura', keys: ['cobertura', 'telhado', 'laje'] },
  { icon: 'building', tipo: 'fachada', keys: ['fachada', 'frontaria', 'empena'] },
  { icon: 'wrench', tipo: 'area_tecnica', keys: ['casa de maquinas', 'area tecnica', 'gerador', 'bombas', 'barrilete', 'shaft', 'shafts', 'maquinas'] },
  { icon: 'zap', tipo: 'area_tecnica', keys: ['quadro eletrico', 'eletrica', 'medidores', 'medidor'] },
  { icon: 'droplet', tipo: 'area_tecnica', keys: ['caixa d agua', 'reservatorio', 'cisterna', 'poco', 'hidraulica'] },
  { icon: 'trash', tipo: 'area_comum', keys: ['lixeira', 'lixo', 'coleta', 'compactador', 'descartes'] },
  { icon: 'box', tipo: 'area_comum', keys: ['deposito', 'estoque', 'almoxarifado'] },
  { icon: 'bike', tipo: 'area_comum', keys: ['bicicletario', 'bicicleta', 'bike'] },
  { icon: 'washer', tipo: 'area_comum', keys: ['lavanderia', 'tanque', 'lavagem'] },
  { icon: 'bath', tipo: 'area_comum', keys: ['sauna', 'spa', 'hidromassagem', 'ofuro', 'banheiro', 'lavabo', 'sanitario', 'vestiario', 'wc'] },
  { icon: 'film', tipo: 'area_comum', keys: ['cinema', 'teatro', 'auditorio'] },
  { icon: 'book', tipo: 'area_comum', keys: ['biblioteca', 'leitura', 'livros'] },
  { icon: 'chair', tipo: 'unidade', keys: ['sala de estar', 'sala', 'salas'] },
  { icon: 'doorClosed', tipo: 'unidade', keys: ['quarto', 'quartos', 'dormitorio', 'dormitorios', 'suite', 'suites'] },
  { icon: 'sofa', tipo: 'area_comum', keys: ['lounge', 'living', 'estar', 'convivio', 'coworking', 'home office'] },
  { icon: 'door', tipo: 'area_comum', keys: ['portaria', 'guarita', 'recepcao', 'hall', 'lobby', 'entrada', 'acesso', 'corredor', 'passagem', 'circulacao'] },
  { icon: 'home', tipo: 'unidade', keys: ['apartamento', 'apto', 'unidade', 'apart'] },
  { icon: 'building', tipo: 'area_comum', keys: ['bloco', 'torre', 'predio', 'edificio'] },
  { icon: 'eye', tipo: 'area_tecnica', keys: ['cftv', 'camera', 'cameras', 'monitoramento', 'interfone'] },
  { icon: 'layers', tipo: 'outro', keys: ['subsolo', 'porao'] },
];

export function localMeta(nome, descricao = '') {
  const text = fold(`${nome || ''} ${descricao || ''}`);
  for (const rule of RULES) {
    if (rule.keys.some((key) => matchesKey(text, key))) {
      return { icon: rule.icon, tipo: rule.tipo };
    }
  }
  return { icon: 'map', tipo: 'outro' };
}

export function iconForLocal(nome, descricao) {
  return localMeta(nome, descricao).icon;
}

export function tipoForLocal(nome, descricao) {
  return localMeta(nome, descricao).tipo;
}

export function parseAreaLocal(value) {
  const text = fold(value);
  if (!text) return '';
  if (text.includes('privativ')) return 'privativa';
  if (text.includes('comum')) return 'comum';
  return '';
}

export function areaForLocal(nome, descricao = '', explicit = '') {
  const parsed = parseAreaLocal(explicit);
  if (parsed) return parsed;
  return tipoForLocal(nome, descricao) === 'unidade' ? 'privativa' : 'comum';
}
