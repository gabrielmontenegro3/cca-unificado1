function limpar(value) {
  return String(value || '').trim();
}

/** 'casas' | 'predios' | null */
export function tipoDoCondominio(unidades) {
  const reais = (unidades || []).filter((u) => !/^[áa]reas comuns$/i.test(limpar(u.identificacao)));
  const casas = reais.filter((u) => /^casa\b/i.test(limpar(u.identificacao))).length;
  const apts = reais.filter((u) => /\b(apt|apto|apartamento)\b/i.test(limpar(u.identificacao)) || limpar(u.andar)).length;
  if (casas && !apts) return 'casas';
  if (apts && !casas) return 'predios';
  return null;
}

export function labelMeuImovel(tipoUnidade) {
  return tipoUnidade === 'casas' ? 'Meu imóvel' : 'Meu apto';
}
