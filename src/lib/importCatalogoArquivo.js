import { isHeaderRow, isPlaceholder, linesOf, splitPipe } from './parseSeed.js';

const SECOES = [
  {
    key: 'catalogo_texto',
    label: 'Base técnica',
    aliases: [
      'base tecnica', 'base técnica', 'catalogo', 'catálogo', 'vinculos', 'vínculos',
      'linhas base', 'fornecedor material local',
    ],
    keys: ['fornecedor', 'material', 'local'],
    minCols: 2,
  },
  {
    key: 'fornecedores_texto',
    label: 'Fornecedores',
    aliases: ['fornecedores', 'fornecedor', 'empresas', 'empresa'],
    keys: ['nome', 'cnpj', 'contato', 'telefone', 'telefone1', 'telefone2', 'localizacao'],
    minCols: 1,
  },
  {
    key: 'materiais_texto',
    label: 'Materiais',
    aliases: ['materiais', 'material', 'produtos', 'produto', 'itens'],
    keys: ['nome', 'prazo_valor', 'prazo_unidade', 'data_fim', 'motivos_perda_garantia', 'descricao', 'telefone'],
    minCols: 1,
  },
  {
    key: 'locais_texto',
    label: 'Locais',
    aliases: ['locais', 'local', 'ambientes', 'ambiente'],
    keys: ['nome', 'descricao', 'area'],
    minCols: 1,
  },
  {
    key: 'contatos_texto',
    label: 'Contatos',
    aliases: ['contatos', 'contato'],
    keys: ['nome', 'telefone', 'email', 'subtitulo'],
    minCols: 1,
  },
  {
    key: 'usuarios_texto',
    label: 'Usuários',
    aliases: ['usuarios', 'usuários', 'usuario', 'usuário'],
    keys: ['nome', 'email', 'cargo'],
    minCols: 1,
  },
];

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function looksLikeCnpj(value) {
  return /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.test(String(value || ''));
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function looksLikePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 13;
}

function looksLikeArea(value) {
  const n = norm(value);
  return n === 'privativa' || n === 'comum' || n === 'area privativa' || n === 'area comum';
}

function looksLikePrazoUnidade(value) {
  const n = norm(value);
  return n === 'dias' || n === 'meses' || n === 'anos' || n === 'mes' || n === 'ano' || n === 'dia';
}

function detectDelimiter(sampleLines) {
  const scores = { '|': 0, '\t': 0, ';': 0, ',': 0 };
  for (const line of sampleLines.slice(0, 40)) {
    for (const d of Object.keys(scores)) {
      const count = line.split(d).length - 1;
      if (count > 0) scores[d] += count;
    }
  }
  let best = '|';
  let bestScore = -1;
  for (const [d, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : '|';
}

function splitLine(line, delimiter) {
  if (delimiter === '|') return splitPipe(line);
  if (delimiter === '\t') return String(line || '').split('\t').map((p) => p.trim());
  if (delimiter === ';') return String(line || '').split(';').map((p) => p.trim());
  // CSV simples (sem aspas aninhadas complexas)
  const parts = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

function matchSecaoHeader(line) {
  const cleaned = String(line || '').replace(/^#+/, '').replace(/[:\-–—]+$/, '').trim();
  const n = norm(cleaned);
  if (!n) return null;

  // Cabeçalhos do padrão: "fornecedor | material | local"
  for (const sec of SECOES) {
    if (isHeaderRow(line, sec.keys)) return sec.key;
  }

  // Título de seção só vale se a linha inteira for o nome (ex.: "Fornecedores")
  const multi = /[|\t;,]/.test(cleaned);
  if (multi) return null;

  for (const sec of SECOES) {
    for (const alias of sec.aliases) {
      if (n === alias || n === `${alias} do condominio` || n === `${alias} do empreendimento`) {
        return sec.key;
      }
    }
  }
  return null;
}

function guessSecaoFromParts(parts) {
  if (!parts.length) return null;
  const joined = parts.join(' ');
  if (parts.length >= 3 && looksLikeEmail(parts[1]) && !looksLikeCnpj(joined)) {
    return 'usuarios_texto';
  }
  if (parts.some(looksLikeCnpj) || (parts.length >= 4 && parts.some(looksLikePhone))) {
    return 'fornecedores_texto';
  }
  if (parts.some(looksLikePrazoUnidade) || /^\d{4}-\d{2}-\d{2}$/.test(parts[3] || '')) {
    return 'materiais_texto';
  }
  if (parts.some(looksLikeArea)) {
    return 'locais_texto';
  }
  if (parts.some(looksLikeEmail) && parts.some(looksLikePhone)) {
    return 'contatos_texto';
  }
  if (parts.length === 3 && !looksLikeEmail(parts[1]) && !looksLikeCnpj(parts[1])) {
    return 'catalogo_texto';
  }
  if (parts.length === 1) return 'materiais_texto';
  if (parts.length === 2) return 'locais_texto';
  return null;
}

function rowToPipe(parts) {
  return parts
    .map((p) => String(p == null ? '' : p).trim())
    .map((p) => (isPlaceholder(p) ? '' : p))
    .join(' | ')
    .replace(/\s+\|\s+$/, '')
    .trim();
}

function emptyResult() {
  return Object.fromEntries(SECOES.map((s) => [s.key, []]));
}

/**
 * Lê um texto longo (arquivo / cola) e identifica listas do catálogo.
 * Retorna linhas já no formato pipe usado pelos campos do formulário.
 */
export function analisarArquivoCatalogo(text) {
  const rawLines = linesOf(text);
  const avisos = [];
  const result = emptyResult();
  if (!rawLines.length) {
    return { listas: result, avisos: ['O arquivo está vazio ou só tinha comentários.'], total: 0 };
  }

  const delimiter = detectDelimiter(rawLines);
  let currentKey = null;
  let usedHeaders = false;
  const orphan = [];

  for (const line of rawLines) {
    const headerKey = matchSecaoHeader(line);
    if (headerKey) {
      currentKey = headerKey;
      usedHeaders = true;
      // Se a linha também é um cabeçalho de colunas do padrão, não grava como item
      const sec = SECOES.find((s) => s.key === headerKey);
      if (sec && isHeaderRow(line, sec.keys)) continue;
      // Título puro de seção
      const parts = splitLine(line, delimiter);
      if (parts.length <= 1) continue;
    }

    const parts = splitLine(line, delimiter).filter((p, idx, arr) => {
      // mantém vazios no meio, mas remove se a linha toda for placeholder
      return idx < arr.length;
    });
    const useful = parts.filter((p) => p && !isPlaceholder(p));
    if (!useful.length) continue;

    const sec = SECOES.find((s) => s.key === currentKey);
    if (sec && isHeaderRow(line, sec.keys)) continue;

    let target = currentKey;
    if (!target) {
      target = guessSecaoFromParts(parts);
      if (!target) {
        orphan.push(rowToPipe(parts));
        continue;
      }
    }

    const cfg = SECOES.find((s) => s.key === target);
    if (!cfg) continue;
    if (useful.length < cfg.minCols) continue;
    if (isHeaderRow(line, cfg.keys)) continue;

    const clipped = parts.slice(0, cfg.keys.length);
    while (clipped.length < cfg.keys.length) clipped.push('');
    // remove trailing empties for cleaner text
    while (clipped.length > 1 && !clipped[clipped.length - 1]) clipped.pop();
    result[target].push(rowToPipe(clipped));
  }

  // Dedup preservando ordem
  for (const sec of SECOES) {
    const seen = new Set();
    result[sec.key] = result[sec.key].filter((line) => {
      const key = norm(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  if (orphan.length) {
    avisos.push(`${orphan.length} linha(s) não classificadas foram ignoradas.`);
  }
  if (!usedHeaders) {
    avisos.push('Nenhum título de seção encontrado; a classificação foi feita pelo formato das linhas.');
  }

  const total = SECOES.reduce((sum, sec) => sum + result[sec.key].length, 0);
  if (!total) {
    avisos.push('Não foi possível identificar itens. Use | ou ; entre colunas, ou títulos como “Fornecedores”.');
  }

  return {
    listas: result,
    avisos,
    total,
    secoes: SECOES.map((s) => ({
      key: s.key,
      label: s.label,
      items: result[s.key],
      count: result[s.key].length,
    })),
  };
}

export async function lerArquivoComoTexto(file) {
  if (!file) throw new Error('Selecione um arquivo.');
  const name = String(file.name || '').toLowerCase();
  if (/\.(xlsx|xls|doc|docx|pdf)$/i.test(name)) {
    throw new Error('Por enquanto use .txt, .csv, .tsv ou .md (texto). Exporte a planilha como CSV.');
  }
  const text = await file.text();
  if (!String(text || '').trim()) throw new Error('O arquivo está vazio.');
  return text;
}

export function mesclarTextoCampo(atual, linhas, modo = 'substituir') {
  const block = (linhas || []).filter(Boolean).join('\n');
  if (!block) return String(atual || '');
  if (modo === 'acrescentar') {
    const prev = String(atual || '').trim();
    return prev ? `${prev}\n${block}` : block;
  }
  return block;
}

/** Junta várias análises (vários arquivos) numa só, sem duplicar linhas. */
export function mesclarAnalises(analises = []) {
  const listas = emptyResult();
  const avisos = [];
  const origens = [];
  for (const analise of analises) {
    if (!analise) continue;
    if (analise.origem) origens.push(analise.origem);
    for (const msg of analise.avisos || []) avisos.push(msg);
    for (const sec of SECOES) {
      listas[sec.key].push(...(analise.listas?.[sec.key] || []));
    }
  }
  for (const sec of SECOES) {
    const seen = new Set();
    listas[sec.key] = listas[sec.key].filter((line) => {
      const key = norm(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const total = SECOES.reduce((sum, sec) => sum + listas[sec.key].length, 0);
  return {
    listas,
    avisos: [...new Set(avisos)],
    total,
    origem: origens.length ? origens.join(', ') : 'arquivos',
    secoes: SECOES.map((s) => ({
      key: s.key,
      label: s.label,
      items: listas[s.key],
      count: listas[s.key].length,
    })),
  };
}

export { SECOES as SECOES_IMPORTACAO };
