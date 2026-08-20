import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { CARGO_LABEL, navFor } from '../lib/permissions';
import { BrandLogo } from './ui';
import { Icon, navIconFor } from './icons';

export function Shell() {
  const { profile, membership, cargoTipo, condo, isGestaoTecnica, condoId, branding, signOut } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = navFor(cargoTipo);
  const coverOnTop = pathname === '/painel' || pathname === '/';

  if (isGestaoTecnica && !condoId) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BrandLogo src={branding?.logo} name={branding?.nome || condo?.nome} />
          <span>
            <strong>{branding?.nome || condo?.nome || 'CCA'}</strong>
            <small>Assistência técnica</small>
          </span>
        </div>
        <nav>
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/' || item.to === '/painel'}>
              <Icon name={navIconFor(item.to, cargoTipo)} size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          {isGestaoTecnica ? (
            <>
              <small>{condo?.nome || 'Empreendimento'}</small>
              <button type="button" onClick={() => navigate('/')}>
                <Icon name="switch" size={16} />
                Trocar condomínio
              </button>
            </>
          ) : (
            <small>{membership?.condominios?.nome}</small>
          )}
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            <Icon name="logout" size={16} />
            Sair
          </button>
        </div>
      </aside>
      <div className={`main${coverOnTop ? ' main-hero' : ''}`}>
        {coverOnTop ? null : (
          <header className="topbar">
            <p className="muted">
              {profile?.nome} · {CARGO_LABEL[cargoTipo] || cargoTipo}
            </p>
          </header>
        )}
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
