import { useEffect, useRef, useState } from 'react';
import { Modal } from './DataList';
import { Alert, Btn, Empty } from './ui';
import { Icon } from './icons';
import { CAMPOS_ESPECIFICIDADE, salvarEspecificidade, temEspecificidade } from '../lib/especificidade';

export function EspecificidadeModal({ open, chamado, userId, onClose, onSaved }) {
  const [valores, setValores] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setValores({
      local_problema: chamado?.local_problema || '',
      subsistema: chamado?.subsistema || '',
      tipo_problema: chamado?.tipo_problema || '',
    });
  }, [open, chamado?.id, chamado?.local_problema, chamado?.subsistema, chamado?.tipo_problema]);

  async function salvar() {
    setBusy(true);
    setError('');
    try {
      await salvarEspecificidade(chamado.id, valores, userId);
      onSaved?.(valores);
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível salvar a especificidade.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Especificidade do chamado"
      onClose={onClose}
      className="modal-sheet--wide"
      footer={(
        <>
          <Btn variant="ghost" disabled={busy} onClick={onClose}>Cancelar</Btn>
          <Btn icon="check" disabled={busy} onClick={salvar}>{busy ? 'Salvando…' : 'Salvar especificidade'}</Btn>
        </>
      )}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        Classifique o chamado. Esses dados alimentam os gráficos da construtora.
      </p>
      <Alert error={error} />
      <div className="espec-grupos">
        {CAMPOS_ESPECIFICIDADE.map(({ campo, titulo, opcoes }) => (
          <fieldset key={campo} className="espec-grupo">
            <legend>{titulo}</legend>
            <div className="espec-opcoes" role="radiogroup" aria-label={titulo}>
              {opcoes.map((op) => {
                const ativo = valores[campo] === op.id;
                return (
                  <button
                    key={op.id}
                    type="button"
                    role="radio"
                    aria-checked={ativo}
                    className={`espec-chip${ativo ? ' is-active' : ''}`}
                    onClick={() => setValores((prev) => ({ ...prev, [campo]: ativo ? '' : op.id }))}
                  >
                    {ativo ? <Icon name="check" size={14} /> : null}
                    {op.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}

export function EspecificidadeBotao({ chamado, onClick }) {
  const marcado = temEspecificidade(chamado);
  return (
    <Btn
      variant="ghost"
      icon="clipboard"
      className={marcado ? 'espec-btn is-set' : 'espec-btn'}
      title={marcado ? 'Especificidade preenchida — clique para editar' : 'Classificar o chamado'}
      onClick={onClick}
    >
      Especificidade
    </Btn>
  );
}

export function GraficoBarras({ titulo, opcoes, contagem, animar = true }) {
  const itens = opcoes
    .map((op) => ({ ...op, n: contagem?.[op.id] || 0 }))
    .sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...itens.map((item) => item.n));
  const soma = itens.reduce((acc, item) => acc + item.n, 0);
  const [pronto, setPronto] = useState(!animar);

  useEffect(() => {
    if (!animar) return undefined;
    setPronto(false);
    const id = requestAnimationFrame(() => setPronto(true));
    return () => cancelAnimationFrame(id);
  }, [animar, contagem]);

  return (
    <section className="grafico">
      <header className="grafico-head">
        <h4>{titulo}</h4>
        <span>{soma} classificado(s)</span>
      </header>
      <ul className="grafico-barras">
        {itens.map((item) => (
          <li key={item.id} className={item.n ? '' : 'is-zero'}>
            <span className="grafico-label">{item.label}</span>
            <span className="grafico-trilho">
              <span
                className="grafico-barra"
                style={{ width: pronto ? `${(item.n / max) * 100}%` : '0%' }}
              />
            </span>
            <span className="grafico-valor">{item.n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GraficosEspecificidade({ resumo, animar = true }) {
  if (!resumo?.classificados) {
    return <Empty text="Nenhum chamado classificado ainda neste condomínio." />;
  }
  return (
    <div className="graficos-grid">
      {CAMPOS_ESPECIFICIDADE.map(({ campo, titulo, opcoes }) => (
        <GraficoBarras key={campo} titulo={titulo} opcoes={opcoes} contagem={resumo[campo]} animar={animar} />
      ))}
    </div>
  );
}

const INTERVALO_SLIDE = 7000;

export function EspecificidadeCarrossel({ slides, onVerRelatorios }) {
  const [indice, setIndice] = useState(0);
  const [pausado, setPausado] = useState(false);
  const timer = useRef(null);
  const total = slides.length;

  useEffect(() => {
    if (indice >= total) setIndice(0);
  }, [total, indice]);

  useEffect(() => {
    clearInterval(timer.current);
    if (pausado || total < 2) return undefined;
    timer.current = setInterval(() => setIndice((i) => (i + 1) % total), INTERVALO_SLIDE);
    return () => clearInterval(timer.current);
  }, [pausado, total]);

  if (!total) return null;
  const atual = slides[Math.min(indice, total - 1)];

  function ir(delta) {
    setIndice((i) => (i + delta + total) % total);
  }

  return (
    <section
      className="espec-carrossel panel"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <header className="espec-carrossel-head">
        <div className="espec-carrossel-titulo">
          <span className="espec-carrossel-kicker">Indicadores dos chamados</span>
          <h2 key={atual.id} className="espec-carrossel-nome">{atual.nome}</h2>
          <small>
            {atual.resumo?.total || 0} chamado(s) · {atual.resumo?.classificados || 0} classificado(s)
          </small>
        </div>
        <div className="espec-carrossel-acoes">
          {total > 1 ? (
            <>
              <button type="button" className="espec-nav" aria-label="Anterior" onClick={() => ir(-1)}>
                <Icon name="chevron" size={18} />
              </button>
              <button type="button" className="espec-nav espec-nav--next" aria-label="Próximo" onClick={() => ir(1)}>
                <Icon name="chevron" size={18} />
              </button>
            </>
          ) : null}
          <Btn icon="clipboard" onClick={() => onVerRelatorios(atual.id)}>Ver relatórios</Btn>
        </div>
      </header>

      <div key={atual.id} className="espec-slide">
        <GraficosEspecificidade resumo={atual.resumo} />
      </div>

      {total > 1 ? (
        <div className="espec-dots" role="tablist" aria-label="Condomínios">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={i === indice}
              aria-label={slide.nome}
              title={slide.nome}
              className={i === indice ? 'is-active' : ''}
              onClick={() => setIndice(i)}
            >
              {i === indice && !pausado ? <span className="espec-dot-progress" style={{ animationDuration: `${INTERVALO_SLIDE}ms` }} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
