import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCnpj, formatTelefone } from '../lib/format';
import { Icon } from './icons';
import ccaLogo from '../assets/logo cca collor (1).png';

export const APP_LOGO = ccaLogo;

export function AppLogo({ className = '', alt = 'CCA' }) {
  return <img className={['app-logo', className].filter(Boolean).join(' ')} src={ccaLogo} alt={alt} />;
}

export function Alert({ error, ok }) {
  if (error) {
    return (
      <p className="alert error" role="alert">
        <Icon name="alert" size={16} />
        <span>{error}</span>
      </p>
    );
  }
  if (ok) {
    return (
      <p className="alert ok" role="status">
        <Icon name="check" size={16} />
        <span>{ok}</span>
      </p>
    );
  }
  return null;
}

export function VerifiedBadge({ title = 'Gestão Técnica verificada' }) {
  return (
    <span className="verified-badge" title={title} aria-label={title}>
      <Icon name="verified" size={14} />
    </span>
  );
}

export function UserAvatar({ src, nome, verified = false, size = 32 }) {
  const label = nome || 'Usuário';
  return (
    <span className={`user-avatar${verified ? ' is-verified' : ''}`} style={{ width: size, height: size }}>
      <span className="user-avatar-face">
        {src ? (
          <img src={src} alt={label} />
        ) : (
          <Icon name="user" size={Math.max(12, Math.round(size * 0.48))} />
        )}
      </span>
      {verified ? <VerifiedBadge /> : null}
    </span>
  );
}

/** Toast flutuante (erro/sucesso). Não limpa formulários. */
export function Toast({ message, type = 'error', onClose }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => onClose?.(), 9000);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div className={`app-toast app-toast--${type}`} role="alert">
      <Icon name={type === 'ok' ? 'check' : 'alert'} size={18} />
      <span className="app-toast-text">{message}</span>
      <button type="button" className="app-toast-close" aria-label="Fechar" onClick={onClose}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function MaskedInput({ mask, value, onChange, ...props }) {
  const formatted = mask === 'cnpj' ? formatCnpj(value) : formatTelefone(value);
  return (
    <input
      inputMode="numeric"
      autoComplete="off"
      {...props}
      value={formatted}
      onChange={(e) => {
        const next = mask === 'cnpj' ? formatCnpj(e.target.value) : formatTelefone(e.target.value);
        onChange(next);
      }}
    />
  );
}

export function Empty({ text }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name="message" size={22} /></span>
      <p>{text}</p>
    </div>
  );
}

export function Badge({ value }) {
  return <span className={`badge ${value || ''}`}>{String(value || '').replaceAll('_', ' ')}</span>;
}

export function ChamadoAdminTag() {
  return <span className="chamado-admin-tag">Administração do condomínio</span>;
}

export function ChamadoAdminBanner() {
  return (
    <aside className="chamado-admin-banner" role="status">
      <span className="chamado-admin-banner-icon" aria-hidden="true">
        <Icon name="building" size={20} />
      </span>
      <div className="chamado-admin-banner-copy">
        <strong>Administração do condomínio</strong>
        <span>Chamado das áreas comuns</span>
      </div>
    </aside>
  );
}

export function BrandLogo({ src, name }) {
  if (src) return <img className="brand-logo" src={src} alt={name || 'Logo'} />;
  return <span className="mark" aria-hidden="true" />;
}

export function CoverImage({ src, alt }) {
  if (!src) return null;
  return <img className="cover-image" src={src} alt={alt || ''} />;
}

export function CoverHero({ src, alt }) {
  if (!src) return null;
  return (
    <div className="cover-hero">
      <img src={src} alt={alt || ''} decoding="async" fetchPriority="high" />
    </div>
  );
}

export function Btn({
  as,
  to,
  href,
  icon,
  variant = 'primary',
  children,
  className = '',
  type = 'button',
  ...props
}) {
  const cls = [
    variant === 'ghost' ? 'btn-ghost' : variant === 'danger' ? 'btn-danger' : 'btn',
    className,
  ].filter(Boolean).join(' ');
  const content = (
    <>
      {icon ? <Icon name={icon} size={17} /> : null}
      {children ? <span>{children}</span> : null}
    </>
  );
  if (to) return <Link className={cls} to={to} {...props}>{content}</Link>;
  if (href) return <a className={cls} href={href} {...props}>{content}</a>;
  const Comp = as || 'button';
  return <Comp className={cls} type={type} {...props}>{content}</Comp>;
}

export function PageTitleRules() {
  return (
    <span className="page-title-rules" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Page({ title, lead, actions, children, search, className = '' }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const hasSearch = Boolean(search && typeof search.onChange === 'function');
  const query = String(search?.value || '');

  useEffect(() => {
    if (!searchOpen) return undefined;
    const node = searchRef.current;
    const id = window.requestAnimationFrame(() => node?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [searchOpen]);

  return (
    <section className={['page', className].filter(Boolean).join(' ')}>
      <div className="page-head">
        <div className="row page-head-row">
          <h1>{title}</h1>
          <PageTitleRules />
          {actions ? <div className="page-actions">{actions}</div> : null}
          {hasSearch ? (
            <div className={`page-search-wrap${searchOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className={`page-search-toggle${searchOpen ? ' is-open' : ''}${query ? ' has-query' : ''}`}
                aria-label={searchOpen ? 'Fechar busca' : 'Procurar registro'}
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen((open) => !open)}
              >
                <Icon name="search" size={18} />
              </button>
              <div className={`page-search${searchOpen ? ' is-open' : ''}`}>
                <div className="page-search-clip">
                  <div className="page-search-card">
                    <i className="page-search-frame" aria-hidden="true" />
                    <i className="page-search-frame" aria-hidden="true" />
                    <label className="page-search-field">
                      <input
                        ref={searchRef}
                        value={query}
                        onChange={(e) => search.onChange(e.target.value)}
                        placeholder={search.placeholder || 'Procurar registro…'}
                        autoComplete="off"
                        spellCheck="false"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {lead ? <p>{lead}</p> : null}
      </div>
      <div className="page-body">{children}</div>
    </section>
  );
}

