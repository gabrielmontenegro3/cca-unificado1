import { useEffect } from 'react';
import { Icon } from './icons';
import { Btn, Empty } from './ui';

function labelize(key) {
  return String(key || '').replaceAll('_', ' ');
}

export function Modal({ open, title, onClose, children, footer, className = '' }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={['modal-sheet', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Detalhe'}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function DetailFields({ fields }) {
  const items = (fields || []).filter((item) => item && item.label != null);
  if (!items.length) return <p className="hint">Sem detalhes.</p>;
  return (
    <dl className="detail-fields">
      {items.map((item) => (
        <div key={item.label} className="detail-field">
          <dt>{item.label}</dt>
          <dd>{item.value == null || item.value === '' ? '—' : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Lista moderna: sem fundo branco; linha fina entre itens; clique abre detalhe. */
export function DataList({
  rows = [],
  empty = 'Nenhum registro.',
  columns = [],
  onSelect,
  getKey = (row) => row.id,
  getTitle,
  getSubtitle,
  interactive = true,
}) {
  if (!rows.length) return <Empty text={empty} />;

  const clickable = interactive && typeof onSelect === 'function';

  return (
    <ul className={`data-list${clickable ? '' : ' data-list--static'}`}>
      {rows.map((row) => {
        const title = getTitle
          ? getTitle(row)
          : (columns[0] ? formatCell(row, columns[0]) : 'Registro');
        const subtitle = getSubtitle
          ? getSubtitle(row)
          : columns.slice(1).map((col) => formatCell(row, col)).filter(Boolean).join(' · ');
        const body = (
          <>
            <span className="data-list-main">
              <strong>{title || '—'}</strong>
              {subtitle ? <span className="data-list-sub">{subtitle}</span> : null}
            </span>
            {clickable ? <Icon name="chevron" size={16} className="data-list-chevron" /> : null}
          </>
        );
        return (
          <li key={getKey(row)}>
            {clickable ? (
              <button
                type="button"
                className="data-list-item"
                onClick={() => onSelect(row)}
              >
                {body}
              </button>
            ) : (
              <div className="data-list-item data-list-item--static">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function formatCell(row, col) {
  if (!col) return '';
  if (typeof col.render === 'function') return col.render(row);
  const key = col.key || col;
  const raw = row?.[key];
  if (raw == null || raw === '') return '';
  return String(raw);
}

export function fieldsFromRecord(row, { exclude = ['id', 'condominio_id', 'created_at', 'updated_at'], labels = {}, formatters = {} } = {}) {
  if (!row) return [];
  return Object.entries(row)
    .filter(([key]) => !exclude.includes(key) && typeof row[key] !== 'object')
    .map(([key, value]) => ({
      label: labels[key] || labelize(key),
      value: formatters[key] ? formatters[key](value, row) : (value == null || value === '' ? '—' : String(value)),
    }));
}

export function ModalAction({ icon, children, ...props }) {
  return (
    <Btn icon={icon} {...props}>
      {children}
    </Btn>
  );
}
