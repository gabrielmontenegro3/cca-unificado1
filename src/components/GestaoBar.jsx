import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { Btn } from './ui';
import { Icon } from './icons';
import { NotificacoesBell } from './NotificacoesPopup';

const TABS = [
  { to: '/', label: 'Condomínios', icon: 'building', match: (path) => path === '/' || path.startsWith('/condominios') },
  { to: '/suporte', label: 'Suporte', icon: 'headset', match: (path) => path.startsWith('/suporte') },
  { to: '/laudos-globais', label: 'Laudo técnico', icon: 'clipboard', match: (path) => path.startsWith('/laudos-globais') },
];

export function GestaoBar() {
  const { profile, signOut } = useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = Math.max(0, TABS.findIndex((tab) => tab.match(pathname)));

  return (
    <header className="portal-bar">
      <div className="portal-user">
        <span className="muted">{profile?.nome}</span>
      </div>
      <nav className="portal-toggle" style={{ '--tab': active, '--tabs': TABS.length }}>
        <span className="portal-toggle-thumb" aria-hidden="true" />
        {TABS.map((tab) => (
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
          onClick={async () => {
            await signOut({ to: '/login' });
          }}
        >
          Sair
        </Btn>
      </div>
    </header>
  );
}
