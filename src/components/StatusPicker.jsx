import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_UI, statusUi } from '../lib/permissions';

const MENU_WIDTH = 200;
const MENU_GAP = 6;
const VIEWPORT_PAD = 8;

function posicaoMenu(anchor, menu) {
  const rect = anchor.getBoundingClientRect();
  const altura = menu?.offsetHeight || 0;
  const largura = Math.max(MENU_WIDTH, menu?.offsetWidth || 0);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(VIEWPORT_PAD, rect.left), vw - largura - VIEWPORT_PAD);
  const cabeAbaixo = rect.bottom + MENU_GAP + altura <= vh - VIEWPORT_PAD;
  const top = cabeAbaixo || rect.top - MENU_GAP - altura < VIEWPORT_PAD
    ? rect.bottom + MENU_GAP
    : rect.top - MENU_GAP - altura;
  return { top, left };
}

export function StatusPicker({ value, onChange, editable }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const closeTimer = useRef(null);
  const anchorRef = useRef(null);
  const menuRef = useRef(null);
  const current = statusUi(value);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return undefined;
    }
    function atualizar() {
      if (anchorRef.current) setPos(posicaoMenu(anchorRef.current, menuRef.current));
    }
    atualizar();
    window.addEventListener('resize', atualizar);
    window.addEventListener('scroll', atualizar, true);
    return () => {
      window.removeEventListener('resize', atualizar);
      window.removeEventListener('scroll', atualizar, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function fora(e) {
      if (anchorRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function esc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

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

  const menu = open ? (
    <div
      ref={menuRef}
      className="status-menu status-menu--floating"
      role="listbox"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
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
  ) : null;

  return (
    <div
      ref={anchorRef}
      className={`status-picker${open ? ' open' : ''}`}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
      <button
        type="button"
        className={`status-chip ${current.id}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={show}
        onFocus={show}
      >
        {current.label}
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
