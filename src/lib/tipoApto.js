export const FICHA_TIPO_APTO = [
  { key: 'area_privativa', label: 'Área privativa', placeholder: '68,40 m²' },
  { key: 'area_total', label: 'Área total', placeholder: '92,10 m²' },
  { key: 'dormitorios', label: 'Dormitórios', placeholder: '2' },
  { key: 'suites', label: 'Suítes', placeholder: '1' },
  { key: 'banheiros', label: 'Banheiros', placeholder: '2' },
  { key: 'lavabo', label: 'Lavabo', placeholder: '1' },
  { key: 'vagas', label: 'Vagas', placeholder: '1 coberta' },
  { key: 'varanda', label: 'Varanda', placeholder: 'gourmet, 8 m²' },
  { key: 'orientacao', label: 'Orientação solar', placeholder: 'norte' },
  { key: 'pe_direito', label: 'Pé-direito', placeholder: '2,70 m' },
  { key: 'posicao', label: 'Posição', placeholder: 'frente' },
];

export const TEXTOS_TIPO_APTO = [
  { key: 'dependencias', label: 'Dependências', placeholder: 'Sala, cozinha integrada, área de serviço, suíte…' },
  { key: 'diferenciais', label: 'Diferenciais', placeholder: 'Piso porcelanato, bancada em quartzo, infraestrutura de ar…' },
  { key: 'descricao', label: 'Descrição', placeholder: 'Resumo deste tipo de apartamento' },
];

export function fichaPreenchida(row) {
  return FICHA_TIPO_APTO.filter((item) => String(row?.[item.key] || '').trim());
}

export function textosPreenchidos(row) {
  return TEXTOS_TIPO_APTO.filter((item) => String(row?.[item.key] || '').trim());
}

export function fichaVazia() {
  return Object.fromEntries([...FICHA_TIPO_APTO, ...TEXTOS_TIPO_APTO].map((item) => [item.key, '']));
}
