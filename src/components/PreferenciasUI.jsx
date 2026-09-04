import { FONTES, TEMAS } from '../lib/prefs';

export function PreferenciasForm({
  tema,
  tamanhoFonte,
  onTema,
  onFonte,
  onSubmit,
  busy = false,
  error = '',
  ok = '',
  submitLabel = 'Salvar',
  lead = '',
}) {
  return (
    <form
      className="prefs-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      {lead ? <p className="prefs-lead">{lead}</p> : null}

      <fieldset className="prefs-fieldset">
        <legend>Tamanho das letras</legend>
        <div className="prefs-options" role="radiogroup" aria-label="Tamanho das letras">
          {FONTES.map((opt) => (
            <label
              key={opt.id}
              className={`prefs-card${tamanhoFonte === opt.id ? ' selected' : ''}`}
            >
              <input
                type="radio"
                name="tamanho_fonte"
                value={opt.id}
                checked={tamanhoFonte === opt.id}
                onChange={() => onFonte(opt.id)}
              />
              <strong className={`prefs-font-sample prefs-font-sample--${opt.id}`}>Aa</strong>
              <span className="prefs-card-label">{opt.label}</span>
              <span className="prefs-card-hint">{opt.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="prefs-fieldset">
        <legend>Aparência</legend>
        <div className="prefs-options" role="radiogroup" aria-label="Aparência">
          {TEMAS.map((opt) => (
            <label
              key={opt.id}
              className={`prefs-card prefs-theme-card prefs-theme-card--${opt.id}${tema === opt.id ? ' selected' : ''}`}
            >
              <input
                type="radio"
                name="tema"
                value={opt.id}
                checked={tema === opt.id}
                onChange={() => onTema(opt.id)}
              />
              <span className="prefs-theme-swatch" aria-hidden="true" />
              <span className="prefs-card-label">{opt.label}</span>
              <span className="prefs-card-hint">{opt.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error ? <p className="alert error" role="alert">{error}</p> : null}
      {ok ? <p className="alert ok" role="status">{ok}</p> : null}

      <div className="prefs-actions">
        <button type="submit" className="btn" disabled={busy || !tema || !tamanhoFonte}>
          {busy ? 'Salvando…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
