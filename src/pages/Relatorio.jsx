import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { can, STATUS_LABEL } from '../lib/permissions';
import { chamadoNumero, formatDate } from '../lib/format';
import { APP_LOGO, Alert, Btn, Empty, Field, Page } from '../components/ui';
import { tipoLabelEvento, tituloRastreabilidade, eventoEhInspecaoAgendada } from '../lib/chamadoRastreabilidade';
import {
  ESCOPO_RELATORIO,
  exportarFolhaPdf,
  flattenTimeline,
  intervaloPadraoRelatorio,
  localChamado,
  montarRelatorioPeriodo,
  ocorrenciaConcluida,
  notaSatisfacaoChamado,
} from '../lib/ocorrenciasRelatorio';
import { estrelasTexto, formatarMediaSatisfacao } from '../components/SatisfacaoEstrelas';

function textoCurto(item) {
  const raw = String(item.observacao || item.descricao || '').trim();
  if (!raw) return '';
  return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
}

function dataEvento(item) {
  return item.data_ocorrencia || item.when || item.created_at;
}

function fimOcorrencia(chamado, registros) {
  if (chamado?.data_resolucao) return chamado.data_resolucao;
  if (!ocorrenciaConcluida(chamado)) return null;
  const last = registros[registros.length - 1];
  return last ? dataEvento(last) : chamado.updated_at;
}

function ReportCard({ item, inspecoes }) {
  const titulo = item.titulo || tituloRastreabilidade(item);
  const quem = item.registrado?.nome || item.usuarios?.nome;
  const parent = item.parent_id
    ? inspecoes.find((i) => i.id === item.parent_id)
    : null;
  const texto = textoCurto(item);
  const quando = dataEvento(item);
  const meta = [
    quem ? `Por ${quem}` : null,
    parent ? `${parent.numero_inspecao}ª inspeção` : null,
    item.atendentes?.length ? `Atendentes: ${item.atendentes.map((a) => a.nome).join(', ')}` : null,
  ].filter(Boolean).join(' · ');

  const tipoCss = eventoEhInspecaoAgendada(item) ? 'inspecao_agendada' : (item.tipo || item.kind);

  return (
    <article className={`report-card report-card--compact report-card--${tipoCss}`}>
      <header className="report-card-head">
        <span className="report-badge">{tipoLabelEvento(item)}</span>
        <time dateTime={quando}>{formatDate(quando)}</time>
      </header>
      <h3>{titulo}</h3>
      {meta ? <p className="report-meta">{meta}</p> : null}
      {texto ? <p className="report-text">{texto}</p> : null}
    </article>
  );
}

export function RelatorioPage() {
  const { condoId, cargoTipo, condo } = useSession();
  const podeAcessar = can(cargoTipo, 'manage_traceability');
  const sheetRef = useRef(null);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [padrao, setPadrao] = useState({ inicio: '', fim: '' });
  const [escopo, setEscopo] = useState('todos');
  const [exibirSatisfacao, setExibirSatisfacao] = useState(false);
  const [applied, setApplied] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!condoId || !podeAcessar) return;
    intervaloPadraoRelatorio(condoId)
      .then((range) => {
        setPadrao(range);
        setInicio(range.inicio);
        setFim(range.fim);
      })
      .catch((err) => setError(err.message));
  }, [condoId, podeAcessar]);

  if (!podeAcessar) return <Navigate to="/visao-geral" replace />;

  const dirty = Boolean(applied && (
    applied.inicio !== inicio
    || applied.fim !== fim
    || applied.escopo !== escopo
  ));

  async function visualizar() {
    setLoading(true);
    setError('');
    try {
      const data = await montarRelatorioPeriodo({
        condoId,
        condoNome: condo?.nome,
        inicio,
        fim,
        escopo,
      });
      setReport(data);
      setApplied({ inicio, fim, escopo });
    } catch (err) {
      setError(err.message || 'Não foi possível montar o relatório.');
    } finally {
      setLoading(false);
    }
  }

  async function baixar() {
    if (!report || dirty) {
      setError('Clique em Visualizar para atualizar a prévia antes de baixar.');
      return;
    }
    setExporting(true);
    setError('');
    try {
      await exportarFolhaPdf(
        sheetRef.current,
        `relatorio-ocorrencias-${inicio}-a-${fim}.pdf`,
      );
    } catch (err) {
      setError(err.message || 'Não foi possível gerar o PDF.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Page
      title="Relatório"
      actions={
        <div className="row trace-actions">
          <Btn icon="search" onClick={visualizar} disabled={loading || !inicio || !fim}>
            {loading ? 'Montando…' : 'Visualizar'}
          </Btn>
          <Btn
            variant="ghost"
            icon="file"
            onClick={baixar}
            disabled={!report || dirty || exporting || loading}
          >
            {exporting ? 'Gerando PDF…' : 'Baixar PDF'}
          </Btn>
        </div>
      }
    >
      <Alert error={error} />

      <section className="report-filters panel">
        <div className="report-filters-grid">
          <div className="report-period-block">
            <Field label="Início">
              <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </Field>
            <Field label="Fim">
              <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </Field>
            <p className="hint">
              Padrão: do primeiro chamado até hoje.
              {padrao.inicio && (inicio !== padrao.inicio || fim !== padrao.fim) ? (
                <button
                  type="button"
                  className="report-reset"
                  onClick={() => {
                    setInicio(padrao.inicio);
                    setFim(padrao.fim);
                  }}
                >
                  Restaurar período completo
                </button>
              ) : null}
            </p>
          </div>

          <div className="report-scope">
            <span className="report-scope-label">Abrangência</span>
            <div className="report-scope-toggle" role="group" aria-label="Abrangência">
              {Object.entries(ESCOPO_RELATORIO).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={escopo === id ? 'is-on' : ''}
                  onClick={() => setEscopo(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="hint">Todos é o padrão. Unidades ou áreas comuns só se você escolher.</p>
          </div>

          <div className="report-scope report-sat-toggle">
            <span className="report-scope-label">Satisfação do cliente</span>
            <div className="report-scope-toggle" role="group" aria-label="Satisfação do cliente">
              <button
                type="button"
                className={exibirSatisfacao ? 'is-on' : ''}
                onClick={() => setExibirSatisfacao(true)}
              >
                Exibir
              </button>
              <button
                type="button"
                className={!exibirSatisfacao ? 'is-on' : ''}
                onClick={() => setExibirSatisfacao(false)}
              >
                Não exibir
              </button>
            </div>
            <p className="hint">
              {exibirSatisfacao
                ? 'A média entra no cabeçalho e cada ocorrência mostra a nota do cliente.'
                : 'O relatório segue sem as avaliações.'}
            </p>
          </div>
        </div>
      </section>

      {!report ? (
        <Empty text="Defina o período e clique em Visualizar para ver o relatório antes de baixar." />
      ) : (
        <div className="report-stage">
          {dirty ? (
            <p className="report-dirty">Os filtros mudaram. Clique em Visualizar para atualizar a prévia.</p>
          ) : null}
          <article className="report-sheet" ref={sheetRef}>
            <img className="report-logo" src={APP_LOGO} alt="CCA" />
            <p className="report-period-line">{report.periodoLabel}</p>
            <h1>Relatório de ocorrências</h1>
            <p className="report-condo">{report.condoNome || 'Condomínio'}</p>
            <p className="report-scope-line">{report.escopoLabel}</p>

            <div className={`report-kpis${exibirSatisfacao ? ' report-kpis--sat' : ''}`}>
              <div><span>Ocorrências</span><strong>{report.stats.ocorrencias}</strong></div>
              <div><span>Ocorrências concluídas com sucesso</span><strong>{report.stats.concluidas}</strong></div>
              <div><span>Unidades atendidas</span><strong>{report.stats.unidadesAtendidas}</strong></div>
              <div><span>Ocorrências na área comum atendidas</span><strong>{report.stats.areasAtendidas}</strong></div>
              {exibirSatisfacao ? (
                <div>
                  <span>Média de satisfação do cliente</span>
                  <strong>
                    {report.stats.mediaSatisfacao == null
                      ? '—'
                      : `${formatarMediaSatisfacao(report.stats.mediaSatisfacao)} / 5`}
                  </strong>
                </div>
              ) : null}
            </div>

            {!report.ocorrencias.length ? (
              <p className="report-empty">Nenhuma ocorrência neste período e abrangência.</p>
            ) : report.ocorrencias.map((row) => {
              const registros = flattenTimeline(row.timeline);
              const inicioOc = row.chamado.created_at;
              const fimOc = fimOcorrencia(row.chamado, registros);
              const nota = notaSatisfacaoChamado(row.chamado);
              return (
              <section className="report-ocorrencia" key={row.chamado.id}>
                <header className="report-ocorrencia-head">
                  <div>
                    <strong>{chamadoNumero(row.chamado.numero_registro)}</strong>
                    <h2>{row.chamado.titulo}</h2>
                    <p className="report-ocorrencia-span">
                      <span>Início {formatDate(inicioOc)}</span>
                      <span>Fim {fimOc ? formatDate(fimOc) : 'Em andamento'}</span>
                    </p>
                  </div>
                  <div className="report-ocorrencia-meta">
                    <span>{localChamado(row.chamado)}</span>
                    <span>{STATUS_LABEL[row.chamado.status] || row.chamado.status}</span>
                    <span>{row.chamado.usuarios?.nome || '—'}</span>
                    {exibirSatisfacao ? (
                      <span className="report-ocorrencia-sat">
                        {nota
                          ? `Satisfação ${estrelasTexto(nota)} ${nota}/5`
                          : 'Satisfação: sem avaliação'}
                      </span>
                    ) : null}
                  </div>
                </header>
                <ol className="report-timeline">
                  {registros.map((item) => (
                    <li key={item.id} className="report-timeline-item">
                      <ReportCard
                        item={item}
                        inspecoes={row.inspecoes}
                      />
                    </li>
                  ))}
                </ol>
              </section>
              );
            })}
          </article>
        </div>
      )}
    </Page>
  );
}
