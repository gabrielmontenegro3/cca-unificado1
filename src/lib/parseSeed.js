function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/e-mail/g, 'email')
    .replace(/[^a-z0-9]+/g, '');
}

export function linesOf(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export function splitPipe(line) {
  return String(line || '').split('|').map((part) => part.trim());
}

export function isPlaceholder(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  if (/^\[.*\]$/.test(text)) return true;
  if (/^\(.*\)$/.test(text)) return true;
  return text === '...' || text === '…' || text === '-' || text === '—';
}

export function isHeaderRow(line, keys) {
  const parts = splitPipe(line).map(norm);
  if (!parts[0] || parts[0] !== norm(keys[0])) return false;
  if (keys[1] && parts[1] && parts[1] !== norm(keys[1])) return false;
  return true;
}

function firstKey(keys, parts) {
  const row = {};
  keys.forEach((key, index) => {
    const value = parts[index] || '';
    row[key] = isPlaceholder(value) ? '' : value;
  });
  return row;
}

export function parseNamedList(text, keys) {
  return linesOf(text)
    .filter((line) => !isHeaderRow(line, keys))
    .map((line) => firstKey(keys, splitPipe(line)))
    .filter((row) => keys.some((key) => row[key]));
}

export function parseCatalogoLinhas(text) {
  return parseNamedList(text, ['fornecedor', 'material', 'local', 'garantia']);
}

/** Padrões só com linhas de exemplo — sem título e sem cabeçalho. */
export const PADROES = {
  catalogo: '[fornecedor] | [material] | [local] | [garantia]',
  fornecedores: '[nome] | [cnpj] | [vendedor] | [tel vendedor] | [telefone1] | [telefone2] | [localizacao]',
  materiais: '[nome]',
  locais: '[nome] | [descricao]',
  garantias: '[nome] | [tempo] | [dias|meses|anos] | [data final AAAA-MM-DD] | [perda da garantia] | [descricao] | [telefone]',
  contatos: '[nome] | [telefone] | [email] | [subtitulo]',
  usuarios: '[nome] | [email] | [cargo]',
};

export const PADRAO_COMPLETO = [
  PADROES.catalogo,
  '',
  PADROES.fornecedores,
  '',
  PADROES.materiais,
  '',
  PADROES.locais,
  '',
  PADROES.garantias,
].join('\n');

export const EMPTY_UNIDADE_CONFIG = {
  tipo: 'predios', // casas | predios
  torres: '1', // 1 | 2 | varios
  qtdTorres: 2,
  nomeacao: 'letra', // letra | numero
  ateLetra: 'B',
  ateNumero: 2,
  andares: 4,
  unidadesPorAndar: 4,
  qtdCasas: 20,
};

function listarBlocos(config) {
  const cfg = { ...EMPTY_UNIDADE_CONFIG, ...(config || {}) };
  if (cfg.tipo === 'casas') return [''];

  const torres = cfg.torres === '1' ? 1 : cfg.torres === '2' ? 2 : Math.max(1, Number(cfg.qtdTorres) || 1);
  if (torres === 1) return ['Torre única'];

  if (cfg.nomeacao === 'numero') {
    const ate = cfg.torres === '2' ? 2 : Math.max(1, Math.min(99, Number(cfg.ateNumero) || torres));
    return Array.from({ length: Math.min(torres, ate) }, (_, i) => `Bloco ${i + 1}`);
  }

  const start = 'A'.charCodeAt(0);
  const ateCode = cfg.torres === '2'
    ? start + 1
    : String(cfg.ateLetra || 'A').toUpperCase().charCodeAt(0);
  const last = Math.min(start + torres - 1, Math.max(start, ateCode));
  const list = [];
  for (let code = start; code <= last; code += 1) list.push(`Bloco ${String.fromCharCode(code)}`);
  return list;
}

/** Gera unidades a partir da configuração visual do formulário. */
export function gerarUnidadesDoConfig(config) {
  const cfg = { ...EMPTY_UNIDADE_CONFIG, ...(config || {}) };
  const rows = [];

  if (cfg.tipo === 'casas') {
    const qtd = Math.max(1, Math.min(500, Number(cfg.qtdCasas) || 1));
    if (cfg.nomeacao === 'letra') {
      const start = 'A'.charCodeAt(0);
      const ateCode = String(cfg.ateLetra || 'A').toUpperCase().charCodeAt(0);
      const last = Math.min(start + qtd - 1, Math.max(start, ateCode), start + 25);
      for (let code = start; code <= last; code += 1) {
        const label = String.fromCharCode(code);
        rows.push({ identificacao: `Casa ${label}`, bloco: label, andar: null });
      }
    } else {
      const ate = Math.max(1, Math.min(500, Number(cfg.ateNumero) || qtd));
      const total = Math.min(qtd, ate);
      for (let n = 1; n <= total; n += 1) {
        rows.push({ identificacao: `Casa ${n}`, bloco: String(n), andar: null });
      }
    }
    return rows;
  }

  const blocos = listarBlocos(cfg);
  const andares = Math.max(1, Math.min(80, Number(cfg.andares) || 1));
  const porAndar = Math.max(1, Math.min(40, Number(cfg.unidadesPorAndar) || 1));

  for (const bloco of blocos) {
    for (let andar = 1; andar <= andares; andar += 1) {
      for (let u = 1; u <= porAndar; u += 1) {
        const apt = `${andar}${String(u).padStart(2, '0')}`;
        rows.push({
          identificacao: blocos.length === 1 && bloco === 'Torre única' ? `Apt ${apt}` : `${bloco} / Apt ${apt}`,
          bloco: bloco === 'Torre única' ? null : bloco,
          andar: String(andar),
        });
      }
    }
  }
  return rows;
}

export function textoUnidadesDoConfig(config) {
  return gerarUnidadesDoConfig(config)
    .map((row) => [row.identificacao, row.bloco || '', row.andar || ''].join(' | '))
    .join('\n');
}

export async function copiarTexto(text) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fallback abaixo */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

export function buildCondoSeed(form) {
  const fromConfig = form?.unidade_config ? gerarUnidadesDoConfig(form.unidade_config) : [];
  const fromText = parseNamedList(form.unidades_texto, ['identificacao', 'bloco', 'andar']);
  return {
    visao_geral: (form.visao_geral || '').trim(),
    sobre_empreendimento: (form.sobre_empreendimento || '').trim(),
    sobre_nos: (form.sobre_nos || '').trim(),
    assistencia_tecnica: (form.assistencia_tecnica || '').trim(),
    boletim_titulo: (form.boletim_titulo || '').trim(),
    boletim_texto: (form.boletim_texto || '').trim(),
    email: (form.email || '').trim(),
    linhas_base: parseCatalogoLinhas(form.catalogo_texto),
    fornecedores: parseNamedList(form.fornecedores_texto, [
      'nome', 'cnpj', 'contato', 'telefone', 'telefone1', 'telefone2', 'localizacao',
    ]),
    materiais: parseNamedList(form.materiais_texto, ['nome']),
    locais: parseNamedList(form.locais_texto, ['nome', 'descricao']),
    garantias: parseNamedList(form.garantias_texto, [
      'nome', 'prazo_valor', 'prazo_unidade', 'data_fim', 'motivos_perda_garantia', 'descricao', 'telefone',
    ]),
    unidades: fromConfig.length ? fromConfig : fromText,
    contatos: parseNamedList(form.contatos_texto, ['nome', 'telefone', 'email', 'subtitulo']),
    usuarios: parseNamedList(form.usuarios_texto, ['nome', 'email', 'cargo']),
  };
}

const CARGOS_SEED = new Set(['administrador', 'construtora', 'administracao', 'morador', 'gestao_tecnica']);
const CAPA_MAX = 20 * 1024 * 1024;
const CAPA_OK = /image\/(jpeg|jpg|png|webp)/i;

function emailOk(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/** Valida o formulário localmente, antes de qualquer escrita no banco. */
export function validarCriacaoCondominio(form) {
  const errors = [];
  const nome = String(form?.nome || '').trim();
  if (nome.length < 2) errors.push('Informe o nome do condomínio (mínimo 2 caracteres).');

  const email = String(form?.email || '').trim();
  if (email && !emailOk(email)) errors.push('E-mail do condomínio inválido.');

  if (form?.imagem_capa) {
    const type = String(form.imagem_capa.type || '');
    if (!CAPA_OK.test(type) && !/\.(jpe?g|png|webp)$/i.test(form.imagem_capa.name || '')) {
      errors.push('A imagem de capa deve ser JPG, PNG ou WebP.');
    }
    if (form.imagem_capa.size > CAPA_MAX) {
      errors.push('A imagem de capa pode ter no máximo 20 MB.');
    }
  }

  if (form?.logo) {
    const type = String(form.logo.type || '');
    if (type && !type.startsWith('image/')) errors.push('O logo precisa ser uma imagem.');
  }

  const cfg = form?.unidade_config;
  if (cfg) {
    if (cfg.tipo === 'casas') {
      if (!(Number(cfg.qtdCasas) > 0)) errors.push('Informe quantas casas o condomínio possui.');
    } else {
      if (!(Number(cfg.andares) > 0)) errors.push('Informe quantos andares cada torre possui.');
      if (!(Number(cfg.unidadesPorAndar) > 0)) errors.push('Informe quantas unidades existem por andar.');
      if (cfg.torres === 'varios' && !(Number(cfg.qtdTorres) > 1)) {
        errors.push('Informe quantas torres/blocos o condomínio possui.');
      }
    }
  }

  let seed;
  try {
    seed = buildCondoSeed(form);
  } catch (err) {
    errors.push(err.message || 'Não foi possível interpretar os textos de cadastro.');
    return errors;
  }

  for (const user of seed.usuarios || []) {
    if (user.email && !emailOk(user.email)) {
      errors.push(`E-mail de usuário inválido: ${user.email}`);
    }
    const cargo = String(user.cargo || 'morador').toLowerCase().replace(/\s+/g, '_');
    if (user.email && cargo && !CARGOS_SEED.has(cargo)) {
      errors.push(`Cargo inválido para ${user.email}: use administrador, construtora, administracao ou morador.`);
    }
  }

  for (const contato of seed.contatos || []) {
    if (contato.email && !emailOk(contato.email)) {
      errors.push(`E-mail de contato inválido: ${contato.email}`);
    }
  }

  return errors;
}

export function resumoCriacaoCondominio(form) {
  const seed = buildCondoSeed(form);
  const files = [
    form?.logo && 'Logo',
    form?.imagem_visao_geral && 'Visão geral',
    form?.imagem_capa && 'Capa',
    form?.imagem_login && 'Login',
    (form?.imagens?.length || 0) > 0 && `${form.imagens.length} imagem(ns)`,
    (form?.documentos?.length || 0) > 0 && `${form.documentos.length} documento(s)`,
  ].filter(Boolean);

  return {
    nome: String(form?.nome || '').trim(),
    cidade: [form?.cidade, form?.estado].filter(Boolean).join('/'),
    fornecedores: seed.fornecedores.length,
    materiais: seed.materiais.length,
    locais: seed.locais.length,
    garantias: seed.garantias.length,
    unidades: seed.unidades.length,
    contatos: seed.contatos.length,
    usuarios: seed.usuarios.length,
    linhasBase: seed.linhas_base.length,
    arquivos: files,
  };
}
