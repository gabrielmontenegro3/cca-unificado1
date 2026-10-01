import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import {
  CAMPOS_ESPECIFICIDADE,
  labelEspecificidade,
  resumoEspecificidades,
  somarResumos,
} from '../lib/especificidade';
import { GestaoBar } from '../components/GestaoBar';
import { GraficosEspecificidade } from '../components/Especificidade';
import { Alert, Empty, Page } from '../components/ui';

function maisFrequente(contagem, campo) {
  const [valor, n] = Object.entries(contagem || {}).sort((a, b) => b[1] - a[1])[0] || [];
  return valor ? { label: labelEspecificidade(campo, valor), n } : null;
}

function percentual(parte, total) {
  if (!total) return '0%';
  return `${Math.round((parte / total) * 100)}%`;
}

export function ConstrutoraRelatoriosPage() {
  const { memberships } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [resumo, setResumo] = useState(null);
  const [error, setError] = useState('');
  const condoSel = searchParams.get('condo') || '';

  const condos = useMemo(() => (memberships || [])
    .map((row) => ({ id: row.condominio_id, nome: row.condominios?.nome || 'Condomínio' }))
    .filter((row) => row.id)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [memberships]);

  useEffect(() => {
    let live = true;
    const ids = condos.map((row) => row.id);
    if (!ids.length) {
      setResumo({});
      return undefined;
    }
    resumoEspecificidades(ids)
      .then((next) => {
        if (live) {
          setResumo(next);
          setError('');
        }
      })
      .catch((err) => {
        if (live) setError(err.message || 'Não foi possível carregar os relatórios.');
      });
    return () => { live = false; };
  }, [condos]);

  const atual = useMemo(() => {
    if (!resumo) return null;
    if (condoSel) return resumo[condoSel] || null;
    return somarResumos(Object.values(resumo));
  }, [resumo, condoSel]);

  const nomeSel = condos.find((row) => row.id === condoSel)?.nome;

  function escolher(id) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('condo', id);
    else next.delete('condo');
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="portal">
      <GestaoBar variant="construtora" />
      <main className="portal-main wide">
        <Page
          className="relatorios-page"
          title="Relatórios dos chamados"
          lead="Local, subsistema e tipo de problema dos chamados, classificados pela Gestão Técnica durante o atendimento."
          actions={(
            <select value={condoSel} onChange={(e) => escolher(e.target.value)} aria-label="Condomínio">
              <option value="">Todos os condomínios</option>
              {condos.map((row) => <option key={row.id} value={row.id}>{row.nome}</option>)}
            </select>
          )}
        >
          <Alert error={error} />
          {!condos.length ? (
            <Empty text="Nenhum condomínio vinculado a esta construtora." />
          ) : !atual ? (
            <p className="muted">{error ? '' : 'Carregando…'}</p>
          ) : (
            <div className="stack">
              <h2 className="relatorios-titulo">{nomeSel || 'Todos os condomínios'}</h2>
              <div className="relatorios-cards">
                <div className="relatorio-card">
                  <span>Chamados</span>
                  <strong>{atual.total}</strong>
                </div>
                <div className="relatorio-card">
                  <span>Classificados</span>
                  <strong>{atual.classificados}</strong>
                  <small>{percentual(atual.classificados, atual.total)} do total</small>
                </div>
                {CAMPOS_ESPECIFICIDADE.map(({ campo, titulo }) => {
                  const top = maisFrequente(atual[campo], campo);
                  return (
                    <div key={campo} className="relatorio-card">
                      <span>{titulo} mais frequente</span>
                      <strong className="relatorio-card-texto">{top?.label || '—'}</strong>
                      {top ? <small>{top.n} chamado(s)</small> : null}
                    </div>
                  );
                })}
              </div>

              <section className="panel">
                <GraficosEspecificidade resumo={atual} />
              </section>

              {!condoSel && condos.length > 1 ? (
                <section className="panel stack">
                  <h3 style={{ margin: 0 }}>Por condomínio</h3>
                  <div className="relatorios-tabela-wrap">
                    <table className="relatorios-tabela">
                      <thead>
                        <tr>
                          <th>Condomínio</th>
                          <th>Chamados</th>
                          <th>Classificados</th>
                          {CAMPOS_ESPECIFICIDADE.map(({ campo, titulo }) => <th key={campo}>{titulo}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {condos.map((row) => {
                          const item = resumo?.[row.id];
                          return (
                            <tr key={row.id} onClick={() => escolher(row.id)}>
                              <td><strong>{row.nome}</strong></td>
                              <td>{item?.total || 0}</td>
                              <td>{item?.classificados || 0}</td>
                              {CAMPOS_ESPECIFICIDADE.map(({ campo }) => (
                                <td key={campo}>{maisFrequente(item?.[campo], campo)?.label || '—'}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </Page>
      </main>
    </div>
  );
}
