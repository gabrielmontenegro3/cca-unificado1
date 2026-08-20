import { Link } from 'react-router-dom';
import { Icon } from './icons';

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

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
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

export function Page({ title, lead, actions, children }) {
  return (
    <section className="page">
      <div className="page-head">
        <div className="row page-head-row">
          <div>
            <h1>{title}</h1>
            {lead ? <p>{lead}</p> : null}
          </div>
          {actions ? <div className="page-actions">{actions}</div> : null}
        </div>
      </div>
      <div className="page-body">{children}</div>
    </section>
  );
}

