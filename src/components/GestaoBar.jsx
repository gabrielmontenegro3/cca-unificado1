import { NavLink, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { Btn } from './ui';
import { Icon } from './icons';

export function GestaoBar() {
  const { profile, signOut } = useSession();
  const navigate = useNavigate();

  return (
    <header className="portal-bar">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <span>
          <strong>CCA Unificado</strong>
          <small>Gestão Técnica</small>
        </span>
      </div>
      <nav className="portal-nav">
        <NavLink to="/" end>
          <Icon name="building" size={16} />
          Condomínios
        </NavLink>
        <NavLink to="/suporte">
          <Icon name="headset" size={16} />
          Suporte
        </NavLink>
      </nav>
      <div className="portal-user">
        <span className="muted">{profile?.nome}</span>
        <Btn
          variant="ghost"
          icon="logout"
          onClick={async () => {
            await signOut();
            navigate('/login');
          }}
        >
          Sair
        </Btn>
      </div>
    </header>
  );
}
