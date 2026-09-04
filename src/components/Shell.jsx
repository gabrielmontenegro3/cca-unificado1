import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { navGroupsFor } from '../lib/permissions';
import { BrandLogo } from './ui';
import { Icon } from './icons';
import { loginPathDoCondominio } from '../lib/branding';
import { NotificacoesBell } from './NotificacoesPopup';

function groupHasPath(group, pathname) {
  return group.items.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
}

export function Shell() {
  const { profile, condo, isGestaoTecnica, condoId, branding, signOut, cargoTipo } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const groups = useMemo(() => navGroupsFor(cargoTipo), [cargoTipo]);
  const coverOnTop = pathname === '/visao-geral' || pathname === '/empreendimento';
  const [openGroups, setOpenGroups] = useState({ empreendimento: true });

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const group of groups) {
        if (groupHasPath(group, pathname)) next[group.id] = true;
      }
      return next;
    });
  }, [pathname, groups]);

  if (isGestaoTecnica && !condoId) {
    return <Navigate to="/" replace />;
  }

  function toggleGroup(id) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function sair() {
    await signOut({
      to: isGestaoTecnica ? '/login' : loginPathDoCondominio(condo?.nome, condoId),
    });
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BrandLogo src={branding?.logo} name={branding?.nome || condo?.nome} />
          <span className="brand-copy">
            <strong>{branding?.nome || condo?.nome || 'CCA'}</strong>
          </span>
        </div>
        <nav className="side-nav">
          {groups.map((group) => {
            const open = Boolean(openGroups[group.id]);
            const activeGroup = groupHasPath(group, pathname);
            return (
              <div key={group.id} className={`nav-group${open ? ' open' : ''}${activeGroup ? ' has-active' : ''}`}>
                <button
                  type="button"
                  className="nav-group-toggle"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={open}
                >
                  <span className="nav-group-label">
                    <Icon name={group.icon} size={18} />
                    {group.label}
                  </span>
                  <Icon name="chevron" size={16} className={`nav-group-chevron${open ? ' open' : ''}`} />
                </button>
                {open ? (
                  <div className="nav-group-items">
                    {group.items.map((item) => (
                      <NavLink key={item.to} to={item.to}>
                        <Icon name={item.icon} size={16} />
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
          {isGestaoTecnica ? (
            <button type="button" className="side-nav-action" onClick={() => navigate('/suporte')}>
              <Icon name="headset" size={18} />
              Suporte
            </button>
          ) : null}
        </nav>
        {isGestaoTecnica ? (
          <div className="side-foot">
            <button type="button" onClick={() => navigate('/')}>
              <Icon name="switch" size={16} />
              Trocar condomínio
            </button>
          </div>
        ) : null}
      </aside>

      <div className={`main${coverOnTop ? ' main-hero' : ''}`}>
        <header className={`condo-topbar${coverOnTop ? ' condo-topbar--hero' : ''}`}>
          <div className="condo-topbar-actions">
            <div className="condo-topbar-user" title={profile?.nome || 'Usuário'}>
              <span className="condo-topbar-avatar" aria-hidden="true">
                <Icon name="user" size={15} />
              </span>
              <span className="condo-topbar-name">{profile?.nome || 'Usuário'}</span>
            </div>

            <NotificacoesBell variant="shell" condoScoped className="condo-topbar-bell" />

            <button
              type="button"
              className={`condo-topbar-icon${pathname.startsWith('/configuracoes') ? ' is-active' : ''}`}
              aria-label="Configurações"
              title="Configurações"
              onClick={() => navigate('/configuracoes')}
            >
              <Icon name="settings" size={17} />
            </button>

            <button
              type="button"
              className="condo-topbar-icon"
              aria-label="Sair"
              title="Sair"
              onClick={sair}
            >
              <Icon name="logout" size={17} />
            </button>
          </div>
        </header>

        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
