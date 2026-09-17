import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { ehCargoConstrutora, navGroupsFor } from '../lib/permissions';
import { BrandLogo, UserAvatar } from './ui';
import { Icon } from './icons';
import { loginPathDaConstrutora, loginPathDoCondominio, nomeExibicaoConstrutora } from '../lib/branding';
import { NotificacoesBell } from './NotificacoesPopup';

function groupHasPath(group, pathname) {
  return group.items.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
}

function NavGroup({ group, open, active, playToken, onToggle }) {
  const panelRef = useRef(null);
  const innerRef = useRef(null);
  const lastToken = useRef(0);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const inner = innerRef.current;
    if (!panel || !inner) return undefined;

    const links = [...inner.querySelectorAll('a')];
    const shouldAnimate = Boolean(playToken) && playToken !== lastToken.current;

    if (!shouldAnimate) {
      panel.style.height = open ? 'auto' : '0px';
      links.forEach((el) => {
        el.style.opacity = open ? '1' : '0';
        el.style.transform = 'none';
      });
      return undefined;
    }

    const from = panel.getBoundingClientRect().height;
    const to = open ? inner.scrollHeight : 0;
    panel.style.overflow = 'hidden';
    panel.style.height = `${from}px`;

    const heightAnim = panel.animate(
      [
        { height: `${from}px` },
        { height: `${to}px` },
      ],
      { duration: 260, easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)', fill: 'forwards' },
    );

    const itemAnims = links.map((el, index, all) => {
      if (open) {
        return el.animate(
          [
            { opacity: 0, transform: 'translateY(-4px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          {
            duration: 240,
            delay: 20 + index * 28,
            easing: 'ease-out',
            fill: 'forwards',
          },
        );
      }
      return el.animate(
        [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-3px)' },
        ],
        {
          duration: 140,
          delay: (all.length - 1 - index) * 16,
          easing: 'ease',
          fill: 'forwards',
        },
      );
    });

    const allAnims = [heightAnim, ...itemAnims];
    let pending = allAnims.length;
    const finish = () => {
      pending -= 1;
      if (pending > 0) return;
      allAnims.forEach((anim) => {
        anim.commitStyles();
        anim.cancel();
      });
      panel.style.height = open ? 'auto' : '0px';
      links.forEach((el) => {
        el.style.opacity = open ? '1' : '0';
        el.style.transform = 'none';
      });
      lastToken.current = playToken;
    };
    allAnims.forEach((anim) => anim.addEventListener('finish', finish));
    return () => {
      allAnims.forEach((anim) => {
        anim.removeEventListener('finish', finish);
        anim.cancel();
      });
    };
  }, [open, playToken]);

  return (
    <div className={`nav-group${open ? ' open' : ''}${active ? ' has-active' : ''}`}>
      <button
        type="button"
        className="nav-group-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="nav-group-label">
          <Icon name={group.icon} size={18} />
          {group.label}
        </span>
        <Icon name="chevron" size={16} className={`nav-group-chevron${open ? ' open' : ''}`} />
      </button>
      <div ref={panelRef} className="nav-group-items" aria-hidden={!open}>
        <div ref={innerRef} className="nav-group-items-inner">
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} tabIndex={open ? undefined : -1}>
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Shell() {
  const { profile, condo, isGestaoTecnica, isConstrutoraOrg, construtora, condoId, branding, fotoUrl, signOut, cargoTipo } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const groups = useMemo(() => navGroupsFor(cargoTipo), [cargoTipo]);
  const coverOnTop = pathname === '/visao-geral' && !ehCargoConstrutora(cargoTipo);
  const [openGroups, setOpenGroups] = useState({ empreendimento: true });
  const [playToken, setPlayToken] = useState({ id: '', token: 0 });
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const group of groups) {
        if (groupHasPath(group, pathname)) next[group.id] = true;
      }
      return next;
    });
  }, [pathname, groups]);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') setNavOpen(false);
    }
    document.body.classList.add('nav-lock');
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('nav-lock');
      document.removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

  if ((isGestaoTecnica || isConstrutoraOrg) && !condoId) {
    return <Navigate to="/" replace />;
  }

  function toggleGroup(id) {
    setPlayToken({ id, token: Date.now() });
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function sair() {
    await signOut({
      to: isGestaoTecnica
        ? '/login'
        : isConstrutoraOrg
          ? loginPathDaConstrutora(nomeExibicaoConstrutora(construtora), construtora?.id)
          : loginPathDoCondominio(condo?.nome, condoId),
    });
  }

  return (
    <div className={`app${navOpen ? ' nav-open' : ''}`}>
      <button
        type="button"
        className="nav-scrim"
        aria-label="Fechar menu"
        tabIndex={navOpen ? 0 : -1}
        onClick={() => setNavOpen(false)}
      />
      <aside className="sidebar" id="app-sidebar">
        <div className="brand">
          <BrandLogo src={branding?.logo} name={branding?.nome || condo?.nome} />
          <span className="brand-copy">
            <strong>{branding?.nome || condo?.nome || 'CCA'}</strong>
          </span>
        </div>
        <nav className="side-nav">
          {groups.map((group) => (
            <NavGroup
              key={group.id}
              group={group}
              open={Boolean(openGroups[group.id])}
              active={groupHasPath(group, pathname)}
              playToken={playToken.id === group.id ? playToken.token : 0}
              onToggle={() => toggleGroup(group.id)}
            />
          ))}
          {isGestaoTecnica ? (
            <button type="button" className="side-nav-action" onClick={() => navigate('/suporte')}>
              <Icon name="headset" size={18} />
              Suporte
            </button>
          ) : null}
        </nav>
        {isGestaoTecnica || isConstrutoraOrg ? (
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
          <button
            type="button"
            className="nav-toggle"
            aria-label={navOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            onClick={() => setNavOpen((open) => !open)}
          >
            <Icon name={navOpen ? 'x' : 'menu'} size={20} />
          </button>
          <div className="condo-topbar-actions">
            <div className="condo-topbar-user" title={profile?.nome || 'Usuário'}>
              <UserAvatar src={fotoUrl} nome={profile?.nome} verified={isGestaoTecnica} size={28} />
              <span className="condo-topbar-name">{profile?.nome || 'Usuário'}</span>
              {isGestaoTecnica ? <span className="sr-only">Gestão Técnica verificada</span> : null}
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
