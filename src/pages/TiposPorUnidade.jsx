import { useEffect, useMemo, useState } from 'react';
import { labelUnidade } from '../lib/format';
import {
  carregarRegrasFinais,
  carregarUnidadesComTipo,
  chaveBloco,
  finalDaUnidade,
  mensagemErroTipoPorUnidade,
  salvarRegraFinal,
  salvarTipoDaUnidade,
  tipoEfetivo,
  tipoPelaRegra,
} from '../lib/tipoPorUnidade';
import { Alert, Btn, Empty } from '../components/ui';
import { Modal } from '../components/DataList';
import { Icon } from '../components/icons';

/** Bloco A antes do B; dentro do bloco, 101, 102… 201. */
function ordenarRotulo(a, b) {
  return String(a.bloco || '').localeCompare(String(b.bloco || ''), 'pt-BR', { numeric: true })
    || String(a.identificacao || '').localeCompare(String(b.identificacao || ''), 'pt-BR', { numeric: true })
    || a.rotulo.localeCompare(b.rotulo, 'pt-BR', { numeric: true });
}

/** Resumo para o painel da tela Meu apto: quantas unidades já têm tipo. */
export function resumoTipos(unidades, regras) {
  const total = unidades.length;
  const comTipo = unidades.filter((u) => tipoEfetivo(u, regras).tipoId).length;
  return { total, comTipo, semTipo: total - comTipo };
}

/**
 * Define o tipo de cada unidade:
 *  1) por final (ex.: final 01 e 06 = Tipo A), para todos os blocos ou um bloco;
 *  2) exceção por unidade (cobertura, garden…), que vence a regra do final.
 */
export function TiposPorUnidadeModal({ open, onClose, condoId, tipos, tipoUnidade, onSalvo }) {
  const [unidades, setUnidades] = useState([]);
  const [regras, setRegras] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [error, setError] = useState('');
  const [escopo, setEscopo] = useState('');
  const [q, setQ] = useState('');
  const [soExcecoes, setSoExcecoes] = useState(false);
  const [salvando, setSalvando] = useState('');
  const ehCasas = tipoUnidade === 'casas';

  async function load() {
    setError('');
    try {
      const [lista, finais] = await Promise.all([carregarUnidadesComTipo(condoId), carregarRegrasFinais(condoId)]);
      setUnidades(lista);
      setRegras(finais);
    } catch (err) {
      setError(mensagemErroTipoPorUnidade(err));
      setUnidades([]);
      setRegras([]);
    } finally {
      setCarregado(true);
    }
  }

  useEffect(() => {
    if (!open || !condoId) return;
    setCarregado(false);
    setEscopo('');
    setQ('');
    setSoExcecoes(false);
    load();
  }, [open, condoId]);

  const nomeTipo = useMemo(() => Object.fromEntries((tipos || []).map((t) => [t.id, t.nome])), [tipos]);

  // Blocos que existem nas unidades (guarda a grafia da primeira vez que aparece).
  const blocos = useMemo(() => {
    const mapa = new Map();
    for (const u of unidades) {
      const texto = String(u.bloco || '').trim();
      if (texto && !mapa.has(chaveBloco(texto))) mapa.set(chaveBloco(texto), texto);
    }
    return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }, [unidades]);

  const finais = useMemo(() => {
    const mapa = new Map();
    for (const u of unidades) {
      if (escopo && chaveBloco(u.bloco) !== chaveBloco(escopo)) continue;
      const final = finalDaUnidade(u.identificacao);
      if (!final) continue;
      if (!mapa.has(final)) mapa.set(final, { total: 0, numeros: new Set() });
      const item = mapa.get(final);
      item.total += 1;
      item.numeros.add(String(u.identificacao || '').trim());
    }
    return [...mapa.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }))
      .map(([final, { total, numeros }]) => ({
        final,
        total,
        numeros: [...numeros].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
      }));
  }, [unidades, escopo]);

  const linhas = useMemo(() => unidades
    .map((u) => {
      const regra = tipoPelaRegra(u, regras);
      return {
        ...u,
        rotulo: labelUnidade(u, u.identificacao || 'Unidade'),
        final: finalDaUnidade(u.identificacao),
        regra,
        efetivo: tipoEfetivo(u, regras),
        excecao: Boolean(u.tipo_apartamento_id && u.tipo_apartamento_id !== regra.tipoId),
      };
    })
    .sort(ordenarRotulo), [unidades, regras]);

  const termo = q.trim().toLowerCase();
  const visiveis = linhas.filter((l) => (!soExcecoes || l.excecao)
    && (!termo || `${l.rotulo} ${l.bloco || ''} ${nomeTipo[l.efetivo.tipoId] || ''}`.toLowerCase().includes(termo)));
  const resumo = resumoTipos(unidades, regras);
  const totalExcecoes = linhas.filter((l) => l.excecao).length;

  function regraDe(final, bloco) {
    return regras.find((r) => r.final === final && chaveBloco(r.bloco) === chaveBloco(bloco)) || null;
  }

  async function mudarRegra(final, tipoId) {
    setSalvando(`f:${final}`);
    setError('');
    try {
      await salvarRegraFinal({ condoId, bloco: escopo, final, tipoId });
      setRegras(await carregarRegrasFinais(condoId));
      onSalvo?.();
    } catch (err) {
      setError(mensagemErroTipoPorUnidade(err));
    } finally {
      setSalvando('');
    }
  }

  async function mudarUnidade(unidade, tipoId) {
    setSalvando(`u:${unidade.id}`);
    setError('');
    const anterior = unidade.tipo_apartamento_id || null;
    setUnidades((atual) => atual.map((u) => (u.id === unidade.id ? { ...u, tipo_apartamento_id: tipoId || null } : u)));
    try {
      await salvarTipoDaUnidade(unidade.id, tipoId);
      onSalvo?.();
    } catch (err) {
      setUnidades((atual) => atual.map((u) => (u.id === unidade.id ? { ...u, tipo_apartamento_id: anterior } : u)));
      setError(mensagemErroTipoPorUnidade(err));
    } finally {
      setSalvando('');
    }
  }

  const semTipos = !(tipos || []).length;

  return (
    <Modal
      open={open}
      title="Tipo de cada unidade"
      onClose={onClose}
      className="modal-sheet--wide tpu-modal"
      footer={<Btn variant="ghost" onClick={onClose}>Fechar</Btn>}
    >
      <div className="tpu">
        <Alert error={error} />
        {semTipos ? (
          <Empty text="Cadastre os tipos primeiro (botão Novo tipo) para depois ligar cada unidade a um tipo." />
        ) : !carregado ? (
          <p className="tpu-dica">Carregando unidades…</p>
        ) : !unidades.length ? (
          <Empty text="Nenhuma unidade cadastrada neste condomínio ainda." />
        ) : (
          <>
            <div className="tpu-resumo" role="status">
              <span><strong>{resumo.comTipo}</strong> de {resumo.total} unidades com tipo</span>
              {resumo.semTipo ? <span className="tpu-resumo-alerta">{resumo.semTipo} sem tipo</span> : <span className="tpu-resumo-ok"><Icon name="check" size={14} /> Todas com tipo</span>}
            </div>

            {!ehCasas ? (
              <section className="tpu-bloco">
                <header className="tpu-bloco-head">
                  <div>
                    <h3>Por final</h3>
                    <p className="tpu-dica">O final é o fim do número: 101, 201 e 301 são o final 01. Defina uma vez e todas as unidades do final recebem o tipo.</p>
                  </div>
                  {blocos.length > 1 ? (
                    <label className="tpu-escopo">
                      <span>Vale para</span>
                      <select value={escopo} onChange={(e) => setEscopo(e.target.value)}>
                        <option value="">Todos os blocos</option>
                        {blocos.map((b) => <option key={b} value={b}>Só o bloco {b}</option>)}
                      </select>
                    </label>
                  ) : null}
                </header>
                {!finais.length ? (
                  <p className="tpu-dica">As unidades não têm número para identificar o final. Use as exceções abaixo.</p>
                ) : (
                  <ul className="tpu-finais">
                    {finais.map(({ final, total, numeros }) => {
                      const regra = regraDe(final, escopo);
                      const geral = escopo ? regraDe(final, '') : null;
                      return (
                        <li key={final} className="tpu-final">
                          <div className="tpu-final-nome">
                            <strong>Final {final}</strong>
                            <small title={numeros.join(', ')}>
                              {total} {total === 1 ? 'unidade' : 'unidades'} · {numeros.slice(0, 6).join(', ')}{numeros.length > 6 ? '…' : ''}                            </small>
                          </div>
                          <select
                            value={regra?.tipo_id || ''}
                            disabled={salvando === `f:${final}`}
                            onChange={(e) => mudarRegra(final, e.target.value)}
                            aria-label={`Tipo do final ${final}`}
                          >
                            <option value="">
                              {escopo
                                ? `Igual a todos os blocos${geral ? ` (${nomeTipo[geral.tipo_id] || 'tipo'})` : ''}`
                                : 'Sem tipo'}
                            </option>
                            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                          </select>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ) : null}

            <section className="tpu-bloco">
              <header className="tpu-bloco-head">
                <div>
                  <h3>{ehCasas ? 'Tipo de cada casa' : 'Exceções por unidade'}</h3>
                  <p className="tpu-dica">
                    {ehCasas
                      ? 'Escolha o tipo de cada casa.'
                      : 'Cobertura, garden ou planta diferente: escolha um tipo só para aquela unidade. Ele vence a regra do final.'}
                  </p>
                </div>
              </header>
              <div className="tpu-filtros">
                <label className="search-field">
                  <Icon name="search" size={16} />
                  <input placeholder="Pesquisar unidade ou tipo" value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
                {!ehCasas ? (
                  <label className="tpu-check">
                    <input type="checkbox" checked={soExcecoes} onChange={(e) => setSoExcecoes(e.target.checked)} />
                    Só exceções ({totalExcecoes})
                  </label>
                ) : null}
              </div>
              {!visiveis.length ? (
                <p className="tpu-dica">Nenhuma unidade encontrada.</p>
              ) : (
                <ul className="tpu-unidades">
                  {visiveis.map((l) => {
                    const nome = nomeTipo[l.efetivo.tipoId];
                    return (
                      <li key={l.id} className={`tpu-unidade${l.excecao ? ' is-excecao' : ''}${l.efetivo.tipoId ? '' : ' is-sem'}`}>
                        <div className="tpu-unidade-nome">
                          <strong>{l.rotulo}</strong>
                          <small>
                            {l.final && !ehCasas ? `Final ${l.final} · ` : ''}
                            {nome
                              ? `${nome}${l.excecao ? ' · exceção desta unidade' : l.efetivo.origem === 'bloco' ? ' · pela regra do bloco' : l.efetivo.origem === 'final' ? ' · pela regra do final' : ''}`
                              : 'Sem tipo'}
                          </small>
                        </div>
                        <select
                          value={l.tipo_apartamento_id || ''}
                          disabled={salvando === `u:${l.id}`}
                          onChange={(e) => mudarUnidade(l, e.target.value)}
                          aria-label={`Tipo de ${l.rotulo}`}
                        >
                          <option value="">
                            {ehCasas
                              ? 'Sem tipo'
                              : l.regra.tipoId
                                ? `Usar o do final (${nomeTipo[l.regra.tipoId] || 'tipo'})`
                                : 'Usar o do final (sem regra)'}
                          </option>
                          {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
