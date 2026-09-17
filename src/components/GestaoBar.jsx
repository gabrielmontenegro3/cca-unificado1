import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { loginPathDaConstrutora, nomeExibicaoConstrutora } from '../lib/branding';
import { Btn, UserAvatar } from './ui';
import { Icon } from './icons';
import { NotificacoesBell } from './NotificacoesPopup';

const GT_TABS = [
  { to: '/construtoras', label: 'Construtoras', icon: 'layers', match: (path) => path.startsWith('/construtoras') },
  { to: '/', label: 'Condomínios', icon: 'building', match: (path) => path === '/' || path.startsWith('/condominios') },
  { to: '/suporte', label: 'Suporte', icon: 'headset', match: (path) => path.startsWith('/suporte') },
  { to: '/laudos-globais', label: 'Laudo técnico', icon: 'clipboard', match: (path) => path.startsWith('/laudos-globais') },
  { to: '/gestao-tecnica', label: 'Gestão Técnica', icon: 'users', match: (path) => path.startsWith('/gestao-tecnica'), adminOnly: true },
];

const CONSTRUTORA_TABS = [
  { to: '/', label: 'Condomínios', icon: 'building', match: (path) => path === '/' || path.startsWith('/condominios') },
  { to: '/laudos-globais', label: 'Governança Técnica', icon: 'clipboard', match: (path) => path.startsWith('/laudos-globais') },
];

export function GestaoBar({ variant = 'gestao' }) {
  const { profile, signOut, isAdminSistema, isGestaoTecnica, isConstrutoraOrg, construtora, fotoUrl } = useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isConstrutora = variant === 'construtora' || isConstrutoraOrg;
  const tabs = (isConstrutora ? CONSTRUTORA_TABS : GT_TABS)
    .filter((tab) => !tab.adminOnly || isAdminSistema);
  const active = Math.max(0, tabs.findIndex((tab) => tab.match(pathname)));

  return (
    <header className="portal-bar">
      <div className="portal-user">
        <UserAvatar src={fotoUrl} nome={profile?.nome} verified={isGestaoTecnica} size={32} />
        <span className="muted">{profile?.nome}</span>
        {isConstrutora ? (
          <span className="portal-role">{nomeExibicaoConstrutora(construtora) || 'Construtora'}</span>
        ) : isAdminSistema ? (
          <span className="portal-role">Administrador do sistema</span>
        ) : isGestaoTecnica ? (
          <span className="portal-role">Gestão Técnica</span>
        ) : null}
      </div>
      <nav className="portal-toggle" style={{ '--tab': active, '--tabs': tabs.length }}>
        <span className="portal-toggle-thumb" aria-hidden="true" />
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === '/'}>
            <Icon name={tab.icon} size={15} />
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="portal-bar-end">
        <NotificacoesBell />
        <Btn
          variant="ghost"
          icon="settings"
          className={`portal-icon-btn${pathname.startsWith('/configuracoes') ? ' is-active' : ''}`}
          aria-label="Configurações"
          title="Configurações"
          onClick={() => navigate('/configuracoes')}
        />
        <Btn
          variant="ghost"
          icon="logout"
          aria-label="Sair"
          title="Sair"
          onClick={async () => {
            await signOut({
              to: isConstrutora
                ? loginPathDaConstrutora(nomeExibicaoConstrutora(construtora), construtora?.id)
                : '/login',
            });
          }}
        >
          Sair
        </Btn>
      </div>
    </header>
  );
}
