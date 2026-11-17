import { supabase } from './supabase';

/**
 * Tipo de apartamento por unidade.
 * Ordem de prioridade: tipo definido na própria unidade (exceção)
 * → regra do final para o bloco da unidade → regra do final para todos os blocos.
 */

const SQL_PENDENTE = /tipo_apartamento_finais|tipo_apartamento_id|schema cache|does not exist|42P01|42703|PGRST204|PGRST200/i;

export function faltaSqlTipoPorUnidade(err) {
  return SQL_PENDENTE.test(String(err?.message || err || ''));
}

export function mensagemErroTipoPorUnidade(err) {
  if (faltaSqlTipoPorUnidade(err)) {
    return 'Rode o arquivo supabase/tipo-por-unidade.sql no SQL Editor do Supabase e tente de novo.';
  }
  return String(err?.message || err || '') || 'Não foi possível concluir.';
}

export function ehAreaComum(unidade) {
  return /^[áa]reas? comu(m|ns)$/i.test(String(unidade?.identificacao || '').trim());
}

/** "101" → "01", "1003" → "03", "Apt 52" → "02". Sem número → ''. */
export function finalDaUnidade(identificacao) {
  const digitos = String(identificacao || '').replace(/[^0-9]/g, '');
  if (!digitos) return '';
  if (digitos.length >= 3) return digitos.slice(-2);
  return digitos.slice(-1).padStart(2, '0');
}

export function chaveBloco(bloco) {
  return String(bloco || '').trim().toLowerCase();
}

/** Tipo efetivo da unidade: { tipoId, origem: 'unidade' | 'bloco' | 'final' | '', final }. */
export function tipoEfetivo(unidade, regras) {
  const final = finalDaUnidade(unidade?.identificacao);
  if (unidade?.tipo_apartamento_id) return { tipoId: unidade.tipo_apartamento_id, origem: 'unidade', final };
  const regra = tipoPelaRegra(unidade, regras);
  return { tipoId: regra.tipoId, origem: regra.origem, final };
}

/** Só o que a regra do final daria (ignora a exceção da unidade). */
export function tipoPelaRegra(unidade, regras) {
  const final = finalDaUnidade(unidade?.identificacao);
  if (!final) return { tipoId: '', origem: '' };
  const bloco = chaveBloco(unidade?.bloco);
  const lista = regras || [];
  if (bloco) {
    const doBloco = lista.find((r) => r.final === final && chaveBloco(r.bloco) === bloco);
    if (doBloco) return { tipoId: doBloco.tipo_id, origem: 'bloco' };
  }
  const geral = lista.find((r) => r.final === final && !chaveBloco(r.bloco));
  if (geral) return { tipoId: geral.tipo_id, origem: 'final' };
  return { tipoId: '', origem: '' };
}

/** Regras por final do condomínio. Sem o SQL rodado devolve lista vazia. */
export async function carregarRegrasFinais(condoId) {
  const { data, error } = await supabase
    .from('tipo_apartamento_finais')
    .select('id, bloco, final, tipo_id')
    .eq('condominio_id', condoId);
  if (error) {
    if (faltaSqlTipoPorUnidade(error)) return [];
    throw error;
  }
  return data || [];
}

/** Grava (ou apaga, com tipoId vazio) a regra de um final. */
export async function salvarRegraFinal({ condoId, bloco = '', final, tipoId }) {
  const { error: delErr } = await supabase
    .from('tipo_apartamento_finais')
    .delete()
    .eq('condominio_id', condoId)
    .eq('bloco', bloco)
    .eq('final', final);
  if (delErr) throw delErr;
  if (!tipoId) return;
  const { error } = await supabase
    .from('tipo_apartamento_finais')
    .insert({ condominio_id: condoId, bloco, final, tipo_id: tipoId });
  if (error) throw error;
}

export async function salvarTipoDaUnidade(unidadeId, tipoId) {
  const { error } = await supabase
    .from('unidades')
    .update({ tipo_apartamento_id: tipoId || null })
    .eq('id', unidadeId);
  if (error) throw error;
}

/** Unidades do condomínio (sem "Áreas comuns") com o tipo de cada uma. */
export async function carregarUnidadesComTipo(condoId) {
  const { data, error } = await supabase
    .from('unidades')
    .select('id, identificacao, bloco, andar, tipo_apartamento_id')
    .eq('condominio_id', condoId);
  if (error) throw error;
  return (data || []).filter((u) => !ehAreaComum(u));
}

async function tipoAntigoDoUsuario(condoId, userId) {
  const { data } = await supabase
    .from('usuario_condominio')
    .select('tipo_apartamento_id')
    .eq('condominio_id', condoId)
    .eq('usuario_id', userId)
    .maybeSingle();
  return data?.tipo_apartamento_id || '';
}

/**
 * Tipo do morador logado: vem da unidade dele.
 * Se a unidade ainda não tem tipo (ou o SQL não foi rodado), usa o tipo antigo do vínculo.
 */
export async function tipoDoMorador(condoId, userId) {
  if (!condoId || !userId) return '';
  const vinculos = await supabase
    .from('unidade_moradores')
    .select('unidades(id, identificacao, bloco, condominio_id, tipo_apartamento_id)')
    .eq('usuario_id', userId);
  if (!vinculos.error) {
    const unidades = (vinculos.data || [])
      .map((row) => (Array.isArray(row.unidades) ? row.unidades[0] : row.unidades))
      .filter((u) => u?.id && u.condominio_id === condoId && !ehAreaComum(u));
    if (unidades.length) {
      const regras = await carregarRegrasFinais(condoId).catch(() => []);
      for (const unidade of unidades) {
        const { tipoId } = tipoEfetivo(unidade, regras);
        if (tipoId) return tipoId;
      }
    }
  }
  return tipoAntigoDoUsuario(condoId, userId);
}

/** usuario_id → tipo_id efetivo, para listas de moradores do condomínio. */
export async function tiposDosMoradores(condoId) {
  const mapa = {};
  const antigos = await supabase
    .from('usuario_condominio')
    .select('usuario_id, tipo_apartamento_id')
    .eq('condominio_id', condoId);
  for (const row of antigos.data || []) {
    if (row.tipo_apartamento_id) mapa[row.usuario_id] = row.tipo_apartamento_id;
  }
  const vinculos = await supabase
    .from('unidade_moradores')
    .select('usuario_id, unidades!inner(id, identificacao, bloco, condominio_id, tipo_apartamento_id)')
    .eq('unidades.condominio_id', condoId);
  if (vinculos.error) return mapa;
  const regras = await carregarRegrasFinais(condoId).catch(() => []);
  for (const row of vinculos.data || []) {
    const unidade = Array.isArray(row.unidades) ? row.unidades[0] : row.unidades;
    if (!unidade || ehAreaComum(unidade)) continue;
    const { tipoId } = tipoEfetivo(unidade, regras);
    if (tipoId) mapa[row.usuario_id] = tipoId;
  }
  return mapa;
}
