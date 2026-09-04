/** Bolinha 3D de aviso de conversa não visualizada (canto superior direito). */
export function UnreadOrb({
  count = 0,
  variant = 'nova',
  title,
  onClick,
  className = '',
}) {
  if (!count && count !== true) return null;
  const n = typeof count === 'number' ? count : 0;
  const label = title
    || (n > 1 ? `${n} conversas não visualizadas` : 'Conversa não visualizada');

  return (
    <button
      type="button"
      className={`unread-orb unread-orb--${variant}${className ? ` ${className}` : ''}`}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      <span className="unread-orb-core" aria-hidden="true" />
      {n > 1 ? <span className="unread-orb-count">{n > 9 ? '9+' : n}</span> : null}
    </button>
  );
}
