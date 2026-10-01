import { supabase } from './supabase';

export const LOCAIS_PROBLEMA = [
  { id: 'banheiro', label: 'Banheiro' },
  { id: 'cozinha', label: 'Cozinha' },
  { id: 'sala', label: 'Sala' },
  { id: 'quarto', label: 'Quarto' },
  { id: 'area_externa', label: 'Área externa' },
  { id: 'fachada', label: 'Fachada' },
  { id: 'garagem', label: 'Garagem' },
  { id: 'area_comum', label: 'Área comum' },
];

export const SUBSISTEMAS = [
  { id: 'hidraulica', label: 'Hidráulica' },
  { id: 'eletrica', label: 'Elétrica' },
  { id: 'impermeabilizacao', label: 'Impermeabilização' },
  { id: 'esquadrias', label: 'Esquadrias' },
  { id: 'revestimentos', label: 'Revestimentos' },
  { id: 'pintura', label: 'Pintura' },
  { id: 'estrutura', label: 'Estrutura' },
  { id: 'climatizacao', label: 'Climatização' },
];

export const TIPOS_PROBLEMA = [
  { id: 'vazamento', label: 'Vazamento' },
  { id: 'infiltracao', label: 'Infiltração' },
  { id: 'trinca_fissura', label: 'Trinca/fissura' },
  { id: 'descolamento', label: 'Descolamento' },
  { id: 'falha_eletrica', label: 'Falha elétrica' },
  { id: 'mau_funcionamento', label: 'Mau funcionamento' },
  { id: 'acabamento', label: 'Acabamento' },
];

export const CAMPOS_ESPECIFICIDADE = [
  { campo: 'local_problema', titulo: 'Local do problema', opcoes: LOCAIS_PROBLEMA },
  { campo: 'subsistema', titulo: 'Subsistema', opcoes: SUBSISTEMAS },
  { campo: 'tipo_problema', titulo: 'Tipo de problema', opcoes: TIPOS_PROBLEMA },
];

export function labelEspecificidade(campo, valor) {
  const grupo = CAMPOS_ESPECIFICIDADE.find((item) => item.campo === campo);
  return grupo?.opcoes.find((op) => op.id === valor)?.label || valor || '';
}

export function temEspecificidade(chamado) {
  return Boolean(chamado?.local_problema || chamado?.subsistema || chamado?.tipo_problema);
}

function erroColunaAusente(error) {
  return /local_problema|subsistema|tipo_problema|especificidade|schema cache|column/i.test(String(error?.message || ''));
}

export async function salvarEspecificidade(chamadoId, valores, userId) {
  if (!chamadoId) throw new Error('Chamado inválido.');
  const payload = {
    local_problema: valores?.local_problema || null,
    subsistema: valores?.subsistema || null,
    tipo_problema: valores?.tipo_problema || null,
    especificidade_em: new Date().toISOString(),
    especificidade_por: userId || null,
  };
  const { error } = await supabase.from('chamados').update(payload).eq('id', chamadoId);
  if (error) {
    throw new Error(erroColunaAusente(error)
      ? 'Rode o SQL chamado-especificidade.sql no Supabase para salvar a especificidade.'
      : error.message);
  }
}

/** Contagens por condomínio: { [condoId]: { total, classificados, local_problema: {id: n}, ... } } */
export async function resumoEspecificidades(condoIds) {
  const ids = [...new Set((condoIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('chamados')
    .select('id, condominio_id, local_problema, subsistema, tipo_problema')
    .in('condominio_id', ids);
  if (error) {
    throw new Error(erroColunaAusente(error)
      ? 'Os gráficos ainda não estão disponíveis. Rode o SQL chamado-especificidade.sql no Supabase.'
      : error.message);
  }
  const resumo = Object.fromEntries(ids.map((id) => [id, {
    total: 0,
    classificados: 0,
    local_problema: {},
    subsistema: {},
    tipo_problema: {},
  }]));
  for (const row of data || []) {
    const alvo = resumo[row.condominio_id];
    if (!alvo) continue;
    alvo.total += 1;
    if (temEspecificidade(row)) alvo.classificados += 1;
    for (const { campo } of CAMPOS_ESPECIFICIDADE) {
      const valor = row[campo];
      if (valor) alvo[campo][valor] = (alvo[campo][valor] || 0) + 1;
    }
  }
  return resumo;
}

export function somarResumos(resumos) {
  const total = { total: 0, classificados: 0, local_problema: {}, subsistema: {}, tipo_problema: {} };
  for (const item of resumos || []) {
    if (!item) continue;
    total.total += item.total;
    total.classificados += item.classificados;
    for (const { campo } of CAMPOS_ESPECIFICIDADE) {
      for (const [valor, n] of Object.entries(item[campo] || {})) {
        total[campo][valor] = (total[campo][valor] || 0) + n;
      }
    }
  }
  return total;
}
