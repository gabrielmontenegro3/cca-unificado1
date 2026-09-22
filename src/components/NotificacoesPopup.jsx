import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { formatDateTime } from '../lib/format';
import {
  NOTIF_TIPO_LABEL,
  destinoNotificacao,
  listarNotificacoes,
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
} from '../lib/notifications';
import { Icon } from './icons';

const MOBILE_BP = 960;
const PANEL_MAX = 380;
const EDGE = 12;

function posicaoPopup(anchor) {
  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw <= MOBILE_BP;
  const spaceBelow = Math.max(120, vh - rect.bottom - EDGE);
  const spaceAbove = Math.max(120, rect.top - EDGE);
  const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
  const maxHeight = Math.min(480, vh * 0.62, openUp ? spaceAbove : spaceBelow);

  if (mobile) {
    return {
      top: openUp ? Math.max(EDGE, rect.top - 8 - maxHeight) : rect.bottom + 8,
      left: EDGE,
      right: EDGE,
      width: 'auto',
      maxHeight,
    };
  }

  const width = Math.min(PANEL_MAX, vw - EDGE * 2);
  let left = rect.right - width;
  if (left < EDGE) left = EDGE;
  if (left + width > vw - EDGE) left = Math.max(EDGE, vw - width - EDGE);

  return {
    top: openUp ? Math.max(EDGE, rect.top - 8 - maxHeight) : rect.bottom + 10,
    left,
    width,
    maxHeight,
  };
}

/**
 * Botão só com ícone de sino + popup de notificações.
 * variant: "portal" (GT) | "shell" (condomínio, discreto)
 * condoScoped: filtra pelo condomínio atual
 */
export function NotificacoesBell({ className = '', variant = 'portal', condoScoped = false }) {
  const { selectCondo, isGestaoTecnica, condoId } = useSession();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const popupRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [rows, setRows] = useState([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filterCondoId = condoScoped || !isGestaoTecnica ? condoId : undefined;

  async function load() {
    try {
      const list = await listarNotificacoes({
        condominioId: filterCondoId,
        limit: 20,
      });
      // Conversas, status de chamado e boletins
      const pertinentes = list.filter((row) => (
        row.tipo === 'mensagem'
        || row.tipo === 'status_chamado'
        || row.tipo === 'boletim'
      ));
      setRows(pertinentes);
      setUnread(pertinentes.filter((r) => !r.lida_em).length);
      setError('');
    } catch (err) {
      setError(err.message || 'Não foi possível carregar.');
      setRows([]);
      setUnread(0);
    }
  }

  useEffect(() => {
    load();
  }, [condoId, isGestaoTecnica, condoScoped]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }

    function place() {
      const anchor = rootRef.current;
      if (!anchor) return;
      setPos(posicaoPopup(anchor));
    }

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);

    function onDoc(e) {
      const t = e.target;
      if (rootRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function abrir(row) {
    setBusy(true);
    try {
      await marcarNotificacaoLida(row.id);
      setOpen(false);
      await destinoNotificacao(row, { selectCondo, navigate, isGestaoTecnica });
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível abrir.');
    } finally {
      setBusy(false);
    }
  }

  async function marcarTodas() {
    setBusy(true);
    try {
      await marcarTodasNotificacoesLidas();
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível marcar como lidas.');
    } finally {
      setBusy(false);
    }
  }

  const popup = open && pos ? createPortal(
    <div
      ref={popupRef}
      className={`notif-popup notif-popup--${variant} notif-popup--portaled`}
      role="dialog"
      aria-label="Notificações"
      style={pos}
    >
      <header className="notif-popup-head">
        <strong>Notificações</strong>
        {unread > 0 ? (
          <button type="button" className="notif-popup-action" disabled={busy} onClick={marcarTodas}>
            Marcar lidas
          </button>
        ) : null}
      </header>

      {error ? <p className="notif-popup-error">{error}</p> : null}

      {!rows.length ? (
        <p className="notif-popup-empty">Nenhuma notificação ainda.</p>
      ) : (
        <ul className="notif-popup-list">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={`notif-popup-item${!row.lida_em ? ' unread' : ''}`}
                disabled={busy}
                onClick={() => abrir(row)}
              >
                <span className="notif-popup-item-main">
                  <strong>{row.titulo}</strong>
                  <span>
                    {[
                      NOTIF_TIPO_LABEL[row.tipo] || row.tipo,
                      row.corpo,
                      formatDateTime(row.created_at),
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {!row.lida_em ? <span className="notif-dot" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="notif-popup-foot">
        <button
          type="button"
          className="notif-popup-action"
          onClick={() => {
            setOpen(false);
            navigate('/notificacoes');
          }}
        >
          Ver todas
        </button>
      </footer>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`notif-bell-wrap notif-bell-wrap--${variant}${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`notif-bell-btn notif-bell-btn--${variant}${open ? ' is-open' : ''}${unread ? ' has-unread' : ''}`}
        aria-label={unread ? `${unread} notificações não lidas` : 'Notificações'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={18} />
        {unread > 0 ? (
          <span className="notif-bell-badge">{unread > 9 ? '9+' : unread}</span>
        ) : null}
      </button>
      {popup}
    </div>
  );
}
