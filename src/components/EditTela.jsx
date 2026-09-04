import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '../lib/session';
import { can } from '../lib/permissions';
import { Btn } from './ui';

/** Gestão Técnica vê a tela como usuário; só edita após clicar em "Editar tela". */
export function useEditTela(permissionAction) {
  const { cargoTipo, isGestaoTecnica } = useSession();
  const { pathname } = useLocation();
  const [editing, setEditing] = useState(false);
  const canRole = Boolean(permissionAction) && can(cargoTipo, permissionAction);

  useEffect(() => {
    setEditing(false);
  }, [pathname]);

  const editable = canRole && (!isGestaoTecnica || editing);
  const showEditButton = isGestaoTecnica && canRole;

  return {
    editable,
    editing,
    showEditButton,
    canRole,
    setEditing,
    toggleEditing() {
      setEditing((value) => !value);
    },
  };
}

export function EditTelaButton({ editing, onToggle, className = '' }) {
  return (
    <Btn
      variant={editing ? 'ghost' : 'primary'}
      icon={editing ? 'check' : 'pencil'}
      className={['edit-tela-btn', className].filter(Boolean).join(' ')}
      onClick={onToggle}
    >
      {editing ? 'Concluir edição' : 'Editar tela'}
    </Btn>
  );
}
