import html2canvas from 'html2canvas';
import { formatDate } from './format';
import { buildTimeline, eventoEhInspecaoAgendada } from './chamadoRastreabilidade';
import {
  listarChamadosCondominio,
  listarHistoricoStatusChamados,
  listarRastreabilidadeChamados,
  periodoPadraoChamados,
} from './api';
import { canvasToPdf, downloadPdf, waitImages } from './chamadoRelatorio';

export const ESCOPO_RELATORIO = {
  todos: 'Todos',
  unidades: 'Unidades',
  areas_comuns: 'Áreas comuns',
};

export function toInputDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

export function endOfDay(dateStr) {
  return new Date(`${dateStr}T23:59:59.999`);
}

export function chamadoEhUnidade(chamado) {
  return Boolean(chamado?.unidade_id);
}

export function chamadoEhAreaComum(chamado) {
  return !chamado?.unidade_id;
}

export function ocorrenciaConcluida(chamado) {
  const s = String(chamado?.status || '').toLowerCase();
  return s === 'resolvido' || s === 'encerrado';
}

export function notaSatisfacaoChamado(chamado) {
  const n = Number(chamado?.satisfacao_estrelas);
  return n >= 1 && n <= 5 ? n : null;
}

export function mediaSatisfacaoChamados(chamados) {
  const notas = (chamados || []).map(notaSatisfacaoChamado).filter((n) => n != null);
  if (!notas.length) return null;
  return {
    media: Math.round((notas.reduce((soma, n) => soma + n, 0) / notas.length) * 10) / 10,
    quantidade: notas.length,
  };
}

export function flattenTimeline(items) {
  const out = [];
  for (const item of items || []) {
    out.push(item);
    if (item.children?.length) out.push(...item.children);
  }
  return out;
}

export function localChamado(chamado) {
  if (chamado?.unidades?.identificacao) return chamado.unidades.identificacao;
  if (chamado?.locais?.nome) return chamado.locais.nome;
  return chamadoEhAreaComum(chamado) ? 'Área comum' : 'Unidade';
}

function inRange(iso, inicio, fim) {
  if (!iso || !inicio || !fim) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= startOfDay(inicio).getTime() && t <= endOfDay(fim).getTime();
}

function filtraEscopo(chamados, escopo) {
  if (escopo === 'unidades') return chamados.filter(chamadoEhUnidade);
  if (escopo === 'areas_comuns') return chamados.filter(chamadoEhAreaComum);
  return chamados;
}

function datasFiltro(item) {
  if (eventoEhInspecaoAgendada(item)) {
    return [item.created_at, item.data_ocorrencia, item.when].filter(Boolean);
  }
  return [item.when || item.data_ocorrencia || item.created_at].filter(Boolean);
}

function filtraTimeline(items, inicio, fim) {
  return (items || []).map((item) => {
    const children = (item.children || []).filter((child) => (
      datasFiltro(child).some((data) => inRange(data, inicio, fim))
    ));
    const selfIn = datasFiltro(item).some((data) => inRange(data, inicio, fim));
    if (!selfIn && !children.length) return null;
    return { ...item, children };
  }).filter(Boolean);
}

export async function intervaloPadraoRelatorio(condoId) {
  const first = await periodoPadraoChamados(condoId);
  return {
    inicio: toInputDate(first),
    fim: toInputDate(new Date()),
  };
}

export async function montarRelatorioPeriodo({
  condoId,
  condoNome,
  inicio,
  fim,
  escopo = 'todos',
}) {
  if (!condoId) throw new Error('Selecione um condomínio.');
  if (!inicio || !fim) throw new Error('Informe o período do relatório.');
  if (startOfDay(inicio) > endOfDay(fim)) {
    throw new Error('A data inicial não pode ser depois da data final.');
  }

  const todos = filtraEscopo(await listarChamadosCondominio(condoId), escopo);
  const ids = todos.map((row) => row.id);
  const [eventos, historicos] = await Promise.all([
    listarRastreabilidadeChamados(ids),
    listarHistoricoStatusChamados(ids),
  ]);

  const eventosPorChamado = new Map();
  const histPorChamado = new Map();
  for (const ev of eventos) {
    const list = eventosPorChamado.get(ev.chamado_id) || [];
    list.push(ev);
    eventosPorChamado.set(ev.chamado_id, list);
  }
  for (const h of historicos) {
    const list = histPorChamado.get(h.chamado_id) || [];
    list.push(h);
    histPorChamado.set(h.chamado_id, list);
  }

  const ocorrencias = [];
  for (const chamado of todos) {
    const timeline = filtraTimeline(
      buildTimeline(
        chamado,
        [],
        eventosPorChamado.get(chamado.id) || [],
        histPorChamado.get(chamado.id) || [],
      ),
      inicio,
      fim,
    );
    if (!timeline.length) continue;
    const inspecoes = (eventosPorChamado.get(chamado.id) || []).filter((r) => r.tipo === 'inspecao');
    ocorrencias.push({ chamado, timeline, inspecoes });
  }

  const concluidas = ocorrencias.filter((row) => ocorrenciaConcluida(row.chamado));
  const unidadesIds = new Set(
    ocorrencias
      .filter((row) => chamadoEhUnidade(row.chamado))
      .map((row) => row.chamado.unidade_id)
      .filter(Boolean),
  );
  const satisfacao = mediaSatisfacaoChamados(ocorrencias.map((row) => row.chamado));

  return {
    condoNome: condoNome || '',
    inicio,
    fim,
    escopo,
    escopoLabel: ESCOPO_RELATORIO[escopo] || ESCOPO_RELATORIO.todos,
    periodoLabel: `${formatDate(startOfDay(inicio))} — ${formatDate(endOfDay(fim))}`,
    ocorrencias,
    stats: {
      ocorrencias: ocorrencias.length,
      concluidas: concluidas.length,
      unidadesAtendidas: unidadesIds.size,
      areasAtendidas: ocorrencias.filter((row) => chamadoEhAreaComum(row.chamado)).length,
      mediaSatisfacao: satisfacao?.media ?? null,
      avaliacoes: satisfacao?.quantidade || 0,
    },
  };
}

export async function exportarFolhaPdf(element, filename) {
  if (!element) throw new Error('Visualize o relatório antes de baixar.');
  if (document.fonts?.ready) await document.fonts.ready;
  await waitImages(element);
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#f3eee6',
    logging: false,
    windowWidth: Math.max(element.scrollWidth, 794),
  });
  downloadPdf(canvasToPdf(canvas), filename);
}
