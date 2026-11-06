import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { PERIODICIDADE } from '../lib/permissions';
import { arquivoEhImagem } from '../lib/api';
import { formatDate, hojeISO } from '../lib/format';
import { urlParaDataUrl } from '../lib/chamadoRelatorio';
import { exportarFolhaPdf } from '../lib/ocorrenciasRelatorio';
import { carregarExecucoes, mensagemSqlManutencao } from '../lib/manutencaoExecucoes';
import { APP_LOGO, Alert, Btn, Empty, Field, Page } from '../components/ui';
import { ArquivoChip } from '../components/ArquivoPreview';
import { podeRegistrar } from './Manutencao';

const hoje = () => hojeISO();

function periodoLabel(inicio, fim) {
  if (inicio && fim) return `${formatDate(inicio)} a ${formatDate(fim)}`;
  if (inicio) return `A partir de ${formatDate(inicio)}`;
  if (fim) return `Até ${formatDate(fim)}`;
  return 'Todo o período';
}

function chave(nome) {
  return String(nome || '').trim().toLocaleLowerCase('pt-BR');
}

async function montarRelatorio({ execucoes, cronograma, inicio, fim, sistema, comFotos }) {
  const filtradas = execucoes.filter((row) => {
    const data = String(row.data_execucao || '');
    if (inicio && data < inicio) return false;
    if (fim && data > fim) return false;
    if (sistema && chave(row.sistema) !== chave(sistema)) return false;
    return true;
  });

  const comImagens = await Promise.all(filtradas.map(async (row) => {
    if (!comFotos) return { ...row, fotos: [] };
    const fotos = await Promise.all(row.arquivos
      .filter((arquivo) => arquivoEhImagem(arquivo) && arquivo.url)
      .map(async (arquivo) => ({ ...arquivo, dataUrl: await urlParaDataUrl(arquivo.url) })));
    return { ...row, fotos: fotos.filter((foto) => foto.dataUrl) };
  }));

  const grupos = new Map();
  for (const row of comImagens) {
    const k = chave(row.sistema);
    if (!grupos.has(k)) grupos.set(k, { nome: row.sistema, execucoes: [] });
    grupos.get(k).execucoes.push(row);
  }
  const porSistema = new Map(cronograma.map((item) => [chave(item.sistema), item]));
  const secoes = [...grupos.values()]
    .map((grupo) => {
      const datas = grupo.execucoes.map((row) => row.data_execucao).filter(Boolean).sort();
      const subsistemas = new Set(grupo.execucoes.map((row) => chave(row.subsistema)).filter(Boolean));
      return {
        ...grupo,
        totalSubsistemas: subsistemas.size,
        primeira: datas[0] || null,
        ultima: datas[datas.length - 1] || null,
        cronograma: porSistema.get(chave(grupo.nome)) || null,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const datas = filtradas.map((row) => row.data_execucao).filter(Boolean).sort();
  return {
    periodoLabel: periodoLabel(inicio, fim),
    escopoLabel: sistema ? `Sistema construtivo: ${sistema}` : 'Todos os sistemas construtivos',
    stats: {
      execucoes: filtradas.length,
      sistemas: secoes.length,
      arquivos: filtradas.reduce((total, row) => total + row.arquivos.length, 0),
      ultima: datas[datas.length - 1] || null,
    },
    secoes,
  };
}

export function RelatorioManutencaoPage() {
  const { condoId, cargoTipo, isGestaoTecnica, condo, branding } = useSession();
  const podeVer = podeRegistrar(cargoTipo, isGestaoTecnica);
  const sheetRef = useRef(null);
  const [execucoes, setExecucoes] = useState([]);
  const [cronograma, setCronograma] = useState([]);
  const [aviso, setAviso] = useState('');
  const [padrao, setPadrao] = useState({ inicio: '', fim: '' });
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [sistema, setSistema] = useState('');
  const [comFotos, setComFotos] = useState(true);
  const [applied, setApplied] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [condoLogo, setCondoLogo] = useState('');

  useEffect(() => {
    let live = true;
    urlParaDataUrl(branding?.logo)
      .then((url) => { if (live) setCondoLogo(url || branding?.logo || ''); })
      .catch(() => { if (live) setCondoLogo(branding?.logo || ''); });
    return () => { live = false; };
  }, [branding?.logo]);

  useEffect(() => {
    if (!condoId || !podeVer) return undefined;
    let live = true;
    Promise.all([
      carregarExecucoes(condoId),
      supabase
        .from('manutencoes_preventivas')
        .select('id, sistema, periodicidade, proxima_execucao, ultima_execucao')
        .eq('condominio_id', condoId),
    ])
      .then(([{ rows, aviso: avisoAnexos }, cron]) => {
        if (!live) return;
        setExecucoes(rows);
        setAviso(avisoAnexos);
        setCronograma(cron.data || []);
        const datas = rows.map((row) => row.data_execucao).filter(Boolean).sort();
        const range = { inicio: datas[0] || hoje(), fim: hoje() };
        setPadrao(range);
        setInicio(range.inicio);
        setFim(range.fim);
      })
      .catch((err) => { if (live) setError(mensagemSqlManutencao(err)); });
    return () => { live = false; };
  }, [condoId, podeVer]);

  const opcoes = useMemo(() => {
    const nomes = new Map();
    execucoes.forEach((row) => {
      const k = chave(row.sistema);
      if (k && !nomes.has(k)) nomes.set(k, row.sistema);
    });
    return [...nomes.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [execucoes]);

  if (!podeVer) return <Navigate to="/visao-geral" replace />;

  const dirty = Boolean(applied && (
    applied.inicio !== inicio
    || applied.fim !== fim
    || applied.sistema !== sistema
    || applied.comFotos !== comFotos
  ));

  async function visualizar() {
    setLoading(true);
    setError('');
    try {
      const data = await montarRelatorio({ execucoes, cronograma, inicio, fim, sistema, comFotos });
      setReport(data);
      setApplied({ inicio, fim, sistema, comFotos });
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
      await exportarFolhaPdf(sheetRef.current, `relatorio-manutencoes-${inicio}-a-${fim}.pdf`);
    } catch (err) {
      setError(err.message || 'Não foi possível gerar o PDF.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Page
      title="Relatório de manutenções"
      actions={(
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
      )}
    >
      <Alert error={error} />
      {aviso ? <p className="hint">{aviso}</p> : null}

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
              Padrão: da primeira execução até hoje.
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
            <span className="report-scope-label">Sistema construtivo</span>
            <select
              className="report-scope-select"
              value={sistema}
              onChange={(e) => setSistema(e.target.value)}
              aria-label="Sistema construtivo"
            >
              <option value="">Todos os sistemas construtivos</option>
              {opcoes.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
            </select>
            <p className="hint">Todos é o padrão. Escolha um para ver só as execuções dele.</p>
          </div>

          <div className="report-scope report-sat-toggle">
            <span className="report-scope-label">Fotos das execuções</span>
            <div className="report-scope-toggle" role="group" aria-label="Fotos das execuções">
              <button type="button" className={comFotos ? 'is-on' : ''} onClick={() => setComFotos(true)}>
                Exibir
              </button>
              <button type="button" className={!comFotos ? 'is-on' : ''} onClick={() => setComFotos(false)}>
                Não exibir
              </button>
            </div>
            <p className="hint">
              {comFotos
                ? 'As fotos anexadas aparecem em cada execução. Outros arquivos aparecem pelo nome.'
                : 'O relatório lista só os nomes dos arquivos anexados.'}
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
            <div className="report-logos">
              {condoLogo ? <img className="report-logo" src={condoLogo} alt={condo?.nome || 'Condomínio'} /> : null}
              {condoLogo ? <span className="report-logos-bar" aria-hidden="true" /> : null}
              <img className="report-logo" src={APP_LOGO} alt="CCA" />
            </div>
            <p className="report-period-line">{report.periodoLabel}</p>
            <h1>Relatório de manutenções preventivas</h1>
            <p className="report-condo">{condo?.nome || 'Condomínio'}</p>
            <p className="report-scope-line">{report.escopoLabel}</p>

            <div className="report-kpis">
              <div><span>Execuções registradas</span><strong>{report.stats.execucoes}</strong></div>
              <div><span>Sistemas atendidos</span><strong>{report.stats.sistemas}</strong></div>
              <div><span>Arquivos anexados</span><strong>{report.stats.arquivos}</strong></div>
              <div><span>Última execução</span><strong>{report.stats.ultima ? formatDate(report.stats.ultima) : '—'}</strong></div>
            </div>

            {!report.secoes.length ? (
              <p className="report-empty">Nenhuma execução neste período.</p>
            ) : report.secoes.map((secao) => {
              const periodo = secao.cronograma
                ? PERIODICIDADE[secao.cronograma.periodicidade]?.label || secao.cronograma.periodicidade
                : null;
              return (
                <section className="report-ocorrencia" key={secao.nome}>
                  <header className="report-ocorrencia-head">
                    <div>
                      <strong>SISTEMA CONSTRUTIVO</strong>
                      <h2>{secao.nome}</h2>
                      <p className="report-ocorrencia-span">
                        <span>Primeira {formatDate(secao.primeira)}</span>
                        <span>Última {formatDate(secao.ultima)}</span>
                      </p>
                    </div>
                    <div className="report-ocorrencia-meta">
                      <span>{secao.execucoes.length} {secao.execucoes.length === 1 ? 'execução' : 'execuções'}</span>
                      <span>{secao.totalSubsistemas} {secao.totalSubsistemas === 1 ? 'subsistema' : 'subsistemas'}</span>
                      {periodo ? <span>Periodicidade {periodo.toLowerCase()}</span> : null}
                      {secao.cronograma?.proxima_execucao ? (
                        <span>Próxima {formatDate(secao.cronograma.proxima_execucao)}</span>
                      ) : null}
                    </div>
                  </header>
                  <ol className="report-timeline">
                    {secao.execucoes.map((row) => {
                      const meta = [
                        row.usuario?.nome ? `Por ${row.usuario.nome}` : null,
                        row.arquivos.length ? `${row.arquivos.length} ${row.arquivos.length === 1 ? 'arquivo' : 'arquivos'}` : 'Sem arquivos',
                      ].filter(Boolean).join(' · ');
                      return (
                        <li key={row.id} className="report-timeline-item">
                          <article className="report-card report-card--compact report-card--execucao">
                            <header className="report-card-head">
                              <span className="report-badge">{row.subsistema || 'Execução'}</span>
                              <time dateTime={row.data_execucao}>{formatDate(row.data_execucao)}</time>
                            </header>
                            <h3>{row.observacao || 'Execução registrada'}</h3>
                            <p className="report-meta">{meta}</p>
                            {row.fotos.length ? (
                              <div className="report-fotos">
                                {row.fotos.map((foto) => (
                                  <img key={foto.id} src={foto.dataUrl} alt={foto.nome_original || 'Foto'} />
                                ))}
                              </div>
                            ) : null}
                            {row.arquivos.length ? (
                              <div className="report-anexos">
                                {row.arquivos.map((arquivo) => (
                                  <ArquivoChip key={arquivo.id} arquivo={arquivo} url={arquivo.url} />
                                ))}
                              </div>
                            ) : null}
                          </article>
                        </li>
                      );
                    })}
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
