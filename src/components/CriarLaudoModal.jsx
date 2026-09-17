import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { chamadoNumero, labelUnidade } from '../lib/format';
import { CRITICIDADE_LAUDO } from '../lib/permissions';
import { criarLaudo } from '../lib/api';
import { Alert, Btn, Field } from './ui';
import { Modal } from './DataList';

export function CriarLaudoModal({ open, onClose, chamado }) {
  const navigate = useNavigate();
  const { condoId, session } = useSession();
  const [form, setForm] = useState({
    descricao: '',
    criticidade: 'media',
  });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const unidade = labelUnidade(chamado?.unidades);

  useEffect(() => {
    if (!open) return;
    setForm({ descricao: '', criticidade: 'media' });
    setFiles([]);
    setError('');
  }, [open, chamado?.id]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!chamado?.id || busy) return;
    setBusy(true);
    setError('');
    try {
      const laudo = await criarLaudo({
        condominioId: condoId || chamado.condominio_id,
        userId: session.user.id,
        chamadoId: chamado.id,
        descricao: String(form.descricao || '').trim(),
        criticidade: form.criticidade,
        files,
      });
      onClose?.();
      navigate(`/governanca-tecnica/${laudo.id}`);
    } catch (err) {
      setError(err.message || 'Não foi possível criar o laudo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Criar laudo técnico"
      onClose={onClose}
      className="modal-sheet--visit"
      footer={(
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Btn>
          <Btn icon="clipboard" onClick={onSubmit} disabled={busy}>
            {busy ? 'Criando…' : 'Criar e abrir chat'}
          </Btn>
        </>
      )}
    >
      <form className="stack" onSubmit={onSubmit}>
        <Alert error={error} />
        <p className="hint">
          O laudo abre um acompanhamento só entre a Gestão Técnica e a Construtora.
          {' '}
          <strong>
            {unidade || 'Unidade'}
            {' · '}
            {chamadoNumero(chamado?.numero_registro)}
          </strong>
        </p>
        <Field label="Grau de criticidade">
          <select
            value={form.criticidade}
            onChange={(e) => setForm({ ...form, criticidade: e.target.value })}
            required
          >
            {CRITICIDADE_LAUDO.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Descrição">
          <textarea
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            placeholder="Resumo técnico para a construtora"
          />
        </Field>
        <Field label="Arquivos (opcional)">
          <input
            type="file"
            multiple
            accept="image/*,.pdf"
            onChange={(e) => setFiles([...e.target.files])}
          />
        </Field>
      </form>
    </Modal>
  );
}
