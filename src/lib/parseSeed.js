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

const HEADER = {
  catalogo: 'fornecedor | material | local | garantia',
  fornecedores: 'nome | cnpj | telefone | email | cidade',
  materiais: 'nome | codigo | fabricante | modelo | descricao',
  locais: 'nome | tipo | bloco | descricao',
  garantias: 'nome | descricao | prazo | unidade_prazo',
  unidades: 'identificacao | bloco | andar',
  contatos: 'nome | telefone | email | subtitulo',
  usuarios: 'nome | email | cargo',
};

function block(title, header, examples) {
  return [`# ${title}`, header, ...examples].join('\n');
}

export const PADROES = {
  catalogo: block(
    'CCA | fornecedor | material | local | garantia',
    HEADER.catalogo,
    [
      '[nome do fornecedor] | [nome do material] | [nome do local] | [garantia]',
      '[nome do fornecedor] | [nome do material] | [nome do local] | [garantia]',
    ],
  ),
  fornecedores: block(
    'CCA | fornecedores',
    HEADER.fornecedores,
    [
      '[nome] | [cnpj] | [telefone] | [email] | [cidade]',
    ],
  ),
  materiais: block(
    'CCA | materiais',
    HEADER.materiais,
    [
      '[nome] | [codigo] | [fabricante] | [modelo] | [descricao]',
    ],
  ),
  locais: block(
    'CCA | locais  (tipo: area_comum, unidade, fachada, cobertura, garagem, area_tecnica, outro)',
    HEADER.locais,
    [
      '[nome] | [tipo] | [bloco] | [descricao]',
    ],
  ),
  garantias: block(
    'CCA | garantias',
    HEADER.garantias,
    [
      '[nome] | [descricao] | [prazo] | [anos ou meses]',
    ],
  ),
  unidades: block(
    'CCA | unidades',
    HEADER.unidades,
    [
      '[identificacao] | [bloco] | [andar]',
    ],
  ),
  contatos: block(
    'CCA | contatos',
    HEADER.contatos,
    [
      '[nome] | [telefone] | [email] | [subtitulo]',
    ],
  ),
  usuarios: block(
    'CCA | usuarios  (cargo: administrador, construtora, administracao, morador)',
    HEADER.usuarios,
    [
      '[nome] | [email] | [cargo]',
    ],
  ),
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
  '',
  PADROES.unidades,
  '',
  PADROES.contatos,
  '',
  PADROES.usuarios,
].join('\n');

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
  return {
    visao_geral: (form.visao_geral || '').trim(),
    sobre_empreendimento: (form.sobre_empreendimento || '').trim(),
    sobre_nos: (form.sobre_nos || '').trim(),
    assistencia_tecnica: (form.assistencia_tecnica || '').trim(),
    boletim_titulo: (form.boletim_titulo || '').trim(),
    boletim_texto: (form.boletim_texto || '').trim(),
    email: (form.email || '').trim(),
    linhas_base: parseCatalogoLinhas(form.catalogo_texto),
    fornecedores: parseNamedList(form.fornecedores_texto, ['nome', 'cnpj', 'telefone', 'email', 'cidade']),
    materiais: parseNamedList(form.materiais_texto, ['nome', 'codigo', 'fabricante', 'modelo', 'descricao']),
    locais: parseNamedList(form.locais_texto, ['nome', 'tipo', 'bloco', 'descricao']),
    garantias: parseNamedList(form.garantias_texto, ['nome', 'descricao', 'prazo_valor', 'prazo_unidade']),
    unidades: parseNamedList(form.unidades_texto, ['identificacao', 'bloco', 'andar']),
    contatos: parseNamedList(form.contatos_texto, ['nome', 'telefone', 'email', 'subtitulo']),
    usuarios: parseNamedList(form.usuarios_texto, ['nome', 'email', 'cargo']),
  };
}
