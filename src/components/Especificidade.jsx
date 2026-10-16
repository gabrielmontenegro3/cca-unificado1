import { useEffect, useId, useRef, useState } from 'react';
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

const CORES_PIZZA = [
  { topo: '#2f7a64', lado: '#184838', brilho: '#8fd0b8' },
  { topo: '#d08a32', lado: '#8a5414', brilho: '#f3cf96' },
  { topo: '#3d6ea5', lado: '#1e3f66', brilho: '#a9c8ea' },
  { topo: '#b55262', lado: '#6c2c38', brilho: '#efb3bd' },
  { topo: '#6a5a9a', lado: '#3a3058', brilho: '#cbbfe6' },
  { topo: '#c46b3a', lado: '#7a3a16', brilho: '#f3c0a0' },
  { topo: '#3f8b86', lado: '#1d524e', brilho: '#9ed9d4' },
  { topo: '#8a6a3b', lado: '#523c1c', brilho: '#e2c48a' },
];

const PIZZA = { cx: 118, cy: 62, rx: 86, ry: 40, profundidade: 18 };

function pontoPizza(cx, cy, rx, ry, graus) {
  const rad = (graus * Math.PI) / 180;
  return [cx + rx * Math.cos(rad), cy + ry * Math.sin(rad)];
}

function caminhoTopo(cx, cy, rx, ry, a0, a1) {
  if (a1 - a0 >= 359.9) {
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} Z`;
  }
  const [x0, y0] = pontoPizza(cx, cy, rx, ry, a0);
  const [x1, y1] = pontoPizza(cx, cy, rx, ry, a1);
  const grande = a1 - a0 > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${rx} ${ry} 0 ${grande} 1 ${x1} ${y1} Z`;
}

function caminhoLado(cx, cy, rx, ry, profundidade, a0, a1) {
  const passos = Math.max(2, Math.ceil((a1 - a0) / 5));
  const trechos = [];
  let atual = [];
  for (let i = 0; i <= passos; i += 1) {
    const angulo = a0 + ((a1 - a0) * i) / passos;
    const rad = (angulo * Math.PI) / 180;
    if (Math.sin(rad) > 0.05) atual.push(pontoPizza(cx, cy, rx, ry, angulo));
    else if (atual.length) {
      trechos.push(atual);
      atual = [];
    }
  }
  if (atual.length) trechos.push(atual);
  return trechos
    .filter((pts) => pts.length >= 2)
    .map((pts) => {
      const topo = pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ');
      const base = [...pts].reverse().map(([x, y]) => `${x.toFixed(2)} ${(y + profundidade).toFixed(2)}`).join(' L ');
      return `M ${topo} L ${base} Z`;
    })
    .join(' ');
}

export function GraficoPizza({ titulo, opcoes, contagem, animar = true }) {
  const uid = useId().replace(/:/g, '');
  const [ativa, setAtiva] = useState('');
  const itens = opcoes.map((op, index) => ({
    ...op,
    n: contagem?.[op.id] || 0,
    cor: CORES_PIZZA[index % CORES_PIZZA.length],
  }));
  const ordenados = [...itens].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'pt-BR'));
  const fatias = ordenados.filter((item) => item.n > 0);
  const soma = fatias.reduce((acc, item) => acc + item.n, 0);
  const { cx, cy, rx, ry, profundidade } = PIZZA;

  let angulo = -90;
  const desenhos = fatias.map((item) => {
    const inicio = angulo;
    const fim = angulo + (item.n / soma) * 360;
    angulo = fim;
    return {
      ...item,
      inicio,
      fim,
      pct: Math.round((item.n / soma) * 100),
      lado: caminhoLado(cx, cy, rx, ry, profundidade, inicio, fim),
      topo: caminhoTopo(cx, cy, rx, ry, inicio, fim),
    };
  });
  const lados = [...desenhos].sort((a, b) => {
    const meioA = Math.sin((((a.inicio + a.fim) / 2) * Math.PI) / 180);
    const meioB = Math.sin((((b.inicio + b.fim) / 2) * Math.PI) / 180);
    return meioA - meioB;
  });

  return (
    <section className={`grafico grafico--pizza${animar ? ' is-animado' : ''}`}>
      <header className="grafico-head">
        <h4>{titulo}</h4>
        <span>{soma} classificado(s)</span>
      </header>
      {soma ? (
        <div className="pizza-corpo">
          <svg className="pizza-svg" viewBox="0 0 236 148" role="img" aria-label={titulo}>
            <ellipse className="pizza-sombra" cx={cx} cy={cy + profundidade + 8} rx={rx * 0.92} ry={ry * 0.55} />
            <defs>
              <clipPath id={`pizza-disco-${uid}`}>
                <ellipse cx={cx} cy={cy} rx={rx - 1} ry={ry - 1} />
              </clipPath>
              {desenhos.map((item) => (
                <linearGradient key={item.id} id={`pizza-${uid}-${item.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={item.cor.brilho} />
                  <stop offset="46%" stopColor={item.cor.topo} />
                  <stop offset="100%" stopColor={item.cor.lado} />
                </linearGradient>
              ))}
            </defs>
            {lados.map((item) => (item.lado ? (
              <path
                key={`${item.id}-lado`}
                className={`pizza-lado${ativa === item.id ? ' is-ativa' : ''}${ativa && ativa !== item.id ? ' is-apagada' : ''}`}
                d={item.lado}
                fill={item.cor.lado}
              />
            ) : null))}
            {desenhos.map((item) => (
              <path
                key={`${item.id}-topo`}
                className={`pizza-topo${ativa === item.id ? ' is-ativa' : ''}${ativa && ativa !== item.id ? ' is-apagada' : ''}`}
                d={item.topo}
                fill={`url(#pizza-${uid}-${item.id})`}
                transform={ativa === item.id ? 'translate(0 -5)' : undefined}
                onMouseEnter={() => setAtiva(item.id)}
                onMouseLeave={() => setAtiva('')}
              >
                <title>{`${item.label}: ${item.n} (${item.pct}%)`}</title>
              </path>
            ))}
            <ellipse className="pizza-brilho" clipPath={`url(#pizza-disco-${uid})`} cx={cx - 8} cy={cy - 10} rx={rx * 0.55} ry={ry * 0.34} />
          </svg>
          <ul className="pizza-legenda">
            {ordenados.map((item) => {
              const pct = soma ? Math.round((item.n / soma) * 100) : 0;
              return (
                <li
                  key={item.id}
                  className={`${item.n ? '' : 'is-zero'}${ativa === item.id ? ' is-ativa' : ''}`}
                  onMouseEnter={() => item.n && setAtiva(item.id)}
                  onMouseLeave={() => setAtiva('')}
                >
                  <i style={{ background: item.cor.topo }} />
                  <span>{item.label}</span>
                  <strong>{item.n ? `${item.n} · ${pct}%` : '0'}</strong>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="pizza-vazio">Nenhum chamado classificado neste grupo.</p>
      )}
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
        <GraficoPizza key={campo} titulo={titulo} opcoes={opcoes} contagem={resumo[campo]} animar={animar} />
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
