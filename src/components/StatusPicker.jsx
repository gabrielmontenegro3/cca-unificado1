import { useEffect, useRef, useState } from 'react';
import { STATUS_UI, statusUi } from '../lib/permissions';

export function StatusPicker({ value, onChange, editable }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);
  const current = statusUi(value);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  function show() {
    clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function hideSoon() {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 220);
  }

  if (!editable) {
    return <span className={`status-chip ${current.id}`}>{current.label}</span>;
  }

  return (
    <div
      className={`status-picker${open ? ' open' : ''}`}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
      <button
        type="button"
        className={`status-chip ${current.id}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        onFocus={show}
      >
        {current.label}
      </button>
      {open ? (
        <div className="status-menu" role="listbox">
          <div className="status-menu-card">
            {STATUS_UI.map((item) => (
              <button
                type="button"
                key={item.id}
                role="option"
                className={item.id === current.id ? 'active' : ''}
                aria-selected={item.id === current.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  if (item.id !== current.id) onChange(item.id);
                }}
              >
                <span className={`status-dot ${item.id}`} />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
