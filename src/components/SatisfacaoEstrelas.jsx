const STAR_PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';

const LABELS = {
  1: 'Muito insatisfeito',
  2: 'Insatisfeito',
  3: 'Regular',
  4: 'Satisfeito',
  5: 'Muito satisfeito',
};

export function notaSatisfacao(value) {
  const n = Number(value);
  return n >= 1 && n <= 5 ? n : null;
}

export function mediaSatisfacao(valores) {
  const notas = (valores || []).map(notaSatisfacao).filter((n) => n != null);
  if (!notas.length) return null;
  return Math.round((notas.reduce((soma, n) => soma + n, 0) / notas.length) * 10) / 10;
}

export function formatarMediaSatisfacao(media) {
  if (media == null) return '—';
  return Number(media).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function estrelasTexto(value) {
  const n = notaSatisfacao(value) || 0;
  return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
}

function StarIcon({ filled, size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={STAR_PATH} />
    </svg>
  );
}

export function SatisfacaoEstrelas({
  value,
  onChange,
  size = 22,
  readOnly = false,
  name = 'satisfação',
}) {
  const nota = notaSatisfacao(value) || 0;
  return (
    <div className={`sat-stars${readOnly ? ' sat-stars--read' : ''}`} role={readOnly ? 'img' : 'radiogroup'} aria-label={name}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= nota;
        const label = `${n} estrela${n > 1 ? 's' : ''} · ${LABELS[n]}`;
        if (readOnly) {
          return (
            <span key={n} className={`sat-star${filled ? ' is-on' : ''}`} title={label}>
              <StarIcon filled={filled} size={size} />
            </span>
          );
        }
        return (
          <button
            key={n}
            type="button"
            className={`sat-star${filled ? ' is-on' : ''}`}
            aria-label={label}
            aria-pressed={n === nota}
            title={label}
            onClick={() => onChange?.(n)}
          >
            <StarIcon filled={filled} size={size} />
          </button>
        );
      })}
    </div>
  );
}

export function SatisfacaoChamado({ nota, onRate, busy, error }) {
  return (
    <aside className="satisfacao-card" role="region" aria-label="Satisfação com o atendimento">
      <div className="satisfacao-card-copy">
        <strong>{nota ? 'Sua avaliação' : 'Como foi o atendimento?'}</strong>
        <p>
          {nota
            ? `${LABELS[nota]}. Você pode alterar as estrelas se quiser.`
            : 'Toque nas estrelas para avaliar o atendimento deste chamado.'}
        </p>
      </div>
      <SatisfacaoEstrelas value={nota} onChange={busy ? undefined : onRate} size={28} />
      {busy ? <span className="satisfacao-card-status">Salvando…</span> : null}
      {error ? <span className="satisfacao-card-error">{error}</span> : null}
    </aside>
  );
}
