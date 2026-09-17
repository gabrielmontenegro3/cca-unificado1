import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can, CRITICIDADE_LAUDO } from '../lib/permissions';
import { chamadoNumero, labelUnidade } from '../lib/format';
import { criarLaudo } from '../lib/api';
import { Alert, Btn, Field, Page } from '../components/ui';

export function LaudosPage() {
  return <Navigate to="/governanca-tecnica" replace />;
}

export function LaudoDetalhePage() {
  const { id } = useParams();
  return <Navigate to={`/governanca-tecnica/${id}`} replace />;
}

export function LaudoNovoPage() {
  const { condoId, session, cargoTipo } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [chamados, setChamados] = useState([]);
  const [form, setForm] = useState({
    descricao: '',
    chamado_id: params.get('chamado') || '',
    criticidade: 'media',
  });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!condoId) return;
    supabase
      .from('chamados')
      .select('id, numero_registro, titulo, status, unidades(identificacao, bloco, andar)')
      .eq('condominio_id', condoId)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setChamados(data || []);
      });
  }, [condoId]);

  if (!can(cargoTipo, 'view_laudos')) return <Navigate to="/visao-geral" replace />;
  if (!can(cargoTipo, 'create_laudo')) {
    return <Page title="Novo laudo"><Alert error="Somente a Gestão Técnica pode abrir um laudo." /></Page>;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!form.chamado_id) {
      setError('Selecione o chamado relacionado a este laudo.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const laudo = await criarLaudo({
        condominioId: condoId,
        userId: session.user.id,
        chamadoId: form.chamado_id,
        descricao: form.descricao,
        criticidade: form.criticidade,
        files,
      });
      navigate(`/governanca-tecnica/${laudo.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Novo laudo" lead="Vincule o laudo a um chamado deste condomínio. O acompanhamento fica entre Gestão Técnica e Construtora.">
      <Alert error={error} />
      <form className="panel stack" onSubmit={onSubmit}>
        <Field label="Chamado relacionado">
          <select
            value={form.chamado_id}
            onChange={(e) => setForm({ ...form, chamado_id: e.target.value })}
            required
          >
            <option value="">Selecione um chamado deste condomínio</option>
            {chamados.map((c) => (
              <option key={c.id} value={c.id}>
                {labelUnidade(c.unidades, 'Unidade')} · {chamadoNumero(c.numero_registro)}
              </option>
            ))}
          </select>
        </Field>
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
        <Field label="Descrição"><textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></Field>
        <Field label="Arquivos"><input type="file" multiple onChange={(e) => setFiles([...e.target.files])} /></Field>
        <Btn type="submit" icon="clipboard" disabled={busy}>{busy ? 'Criando…' : 'Criar e abrir chat'}</Btn>
      </form>
    </Page>
  );
}
