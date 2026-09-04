import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { can, STATUS_LABEL } from '../lib/permissions';
import { chamadoNumero, formatDate, formatDateTime } from '../lib/format';
import { agendarVisitaChamado, listarChamadosCondominio, listarVisitasAgendadas } from '../lib/api';
import { toInputDate } from '../lib/ocorrenciasRelatorio';
import { horarioDoEvento, tituloRastreabilidade } from '../lib/chamadoRastreabilidade';
import { Alert, Badge, Btn, Empty, Field, Page } from '../components/ui';
import { Icon } from '../components/icons';
import { Modal } from '../components/DataList';

function inicioHoje() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function VisitCard({ visita }) {
  const chamado = visita.chamado;
  const hora = horarioDoEvento(visita);
  const quando = visita.data_ocorrencia || visita.created_at;
  return (
    <article className="visit-card">
      <div className="visit-card-top">
        <strong>{formatDate(quando)}{hora ? ` · ${hora}` : ''}</strong>
        {chamado ? <Badge value={chamado.status} /> : null}
      </div>
      <span className="visit-card-title">
        {chamado ? `${chamadoNumero(chamado.numero_registro)} · ${chamado.titulo}` : tituloRastreabilidade(visita)}
      </span>
      <small>
        {chamado?.unidades?.identificacao || chamado?.locais?.nome || 'Chamado'}
        {chamado?.usuarios?.nome ? ` · ${chamado.usuarios.nome}` : ''}
        {' · '}
        Agendado em {formatDateTime(visita.created_at)}
      </small>
      {chamado ? (
        <div className="visit-card-links">
          <Link to={`/rastreabilidade/${chamado.id}`}>Rastreabilidade</Link>
          <Link to={`/chamados/${chamado.id}`}>Chat</Link>
        </div>
      ) : null}
    </article>
  );
}

export function VisitaAgendadaBanner({ visita }) {
  if (!visita) return null;
  const hora = horarioDoEvento(visita);
  const quando = visita.data_ocorrencia || visita.created_at;
  return (
    <aside className="visita-banner" role="status">
      <span className="visita-banner-icon" aria-hidden="true">
        <Icon name="calendar" size={26} />
      </span>
      <div className="visita-banner-copy">
        <strong>Visita agendada</strong>
        <span className="visita-banner-date">
          {formatDate(quando)}
          {hora ? ` às ${hora}` : ''}
        </span>
      </div>
    </aside>
  );
}

export function AgendarVisitaForm({
  chamadoId,
  condominioId,
  userId,
  extraFields,
  locked = false,
  onScheduled,
  onClose,
}) {
  const [data, setData] = useState(toInputDate(new Date()));
  const [horario, setHorario] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setOk('');
    if (!chamadoId) {
      setError('Selecione o chamado.');
      return;
    }
    if (!data) {
      setError('Informe a data da visita.');
      return;
    }
    setBusy(true);
    let closed = false;
    try {
      await agendarVisitaChamado({
        chamadoId,
        condominioId,
        userId,
        data,
        horario,
      });
      setOk('Visita agendada. O chat do chamado e a rastreabilidade foram atualizados.');
      setHorario('');
      await onScheduled?.();
      closed = Boolean(onClose);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Não foi possível agendar a visita.');
    } finally {
      if (!closed) setBusy(false);
    }
  }

  return (
    <form className={`visit-form${locked ? ' visit-form--locked' : ' panel'}`} onSubmit={onSubmit}>
      <Alert error={error} ok={ok} />
      {extraFields}
      <div className="visit-form-grid">
        <Field label="Data">
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </Field>
        <Field label="Horário (opcional)">
          <input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} />
        </Field>
      </div>
      <p className="hint">
        Ao agendar, o chamado recebe um alerta no chat e um registro “Visita agendada, data: …” na rastreabilidade.
        A inspeção em si só entra depois, manualmente, no dia da visita.
      </p>
      <div className="row">
        <Btn type="submit" icon="calendar" disabled={busy || !chamadoId || !data}>
          {busy ? 'Agendando…' : 'Agendar visita'}
        </Btn>
      </div>
    </form>
  );
}

export function AgendarVisitaModal({ open, onClose, chamadoId, condominioId, onScheduled }) {
  const { condoId, session } = useSession();

  return (
    <Modal open={open} title="Agendar visita" onClose={onClose} className="modal-sheet--visit">
      <AgendarVisitaForm
        chamadoId={chamadoId}
        condominioId={condominioId || condoId}
        userId={session?.user?.id}
        locked
        onScheduled={onScheduled}
        onClose={onClose}
      />
    </Modal>
  );
}

export function AgendarVisitaPage() {
  const { condoId, cargoTipo, session } = useSession();
  const [params] = useSearchParams();
  const podeAcessar = can(cargoTipo, 'manage_traceability');
  const [chamados, setChamados] = useState([]);
  const [visitas, setVisitas] = useState([]);
  const [q, setQ] = useState('');
  const [chamadoId, setChamadoId] = useState(params.get('chamado') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!condoId || !podeAcessar) return;
    setLoading(true);
    setError('');
    try {
      const [lista, agendadas] = await Promise.all([
        listarChamadosCondominio(condoId),
        listarVisitasAgendadas(condoId),
      ]);
      setChamados(lista || []);
      setVisitas(agendadas || []);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os chamados.');
    } finally {
      setLoading(false);
    }
  }, [condoId, podeAcessar]);

  useEffect(() => {
    load();
  }, [load]);

  const abertos = useMemo(
    () => (chamados || []).filter((row) => row.status !== 'cancelado'),
    [chamados],
  );

  const filtrados = useMemo(() => {
    const text = q.trim().toLowerCase();
    if (!text) return abertos;
    return abertos.filter((row) => {
      const blob = `${row.titulo} ${row.numero_registro} ${row.usuarios?.nome || ''} ${row.unidades?.identificacao || ''} ${row.locais?.nome || ''}`.toLowerCase();
      return blob.includes(text);
    });
  }, [abertos, q]);

  const opcoes = useMemo(() => {
    if (!chamadoId || filtrados.some((row) => row.id === chamadoId)) return filtrados;
    const extra = chamados.find((row) => row.id === chamadoId);
    return extra ? [extra, ...filtrados] : filtrados;
  }, [filtrados, chamadoId, chamados]);

  const hoje = inicioHoje();
  const proximas = visitas.filter((v) => new Date(v.data_ocorrencia || v.created_at) >= hoje);
  const anteriores = visitas.filter((v) => new Date(v.data_ocorrencia || v.created_at) < hoje).reverse();

  if (!podeAcessar) return <Navigate to="/visao-geral" replace />;

  return (
    <Page
      title="Agendar visita"
      lead="Escolha o chamado e a data. No dia da visita, registre a inspeção em Rastreabilidade com Criar evento."
    >
      <Alert error={error} />

      <AgendarVisitaForm
        chamadoId={chamadoId}
        condominioId={condoId}
        userId={session?.user?.id}
        onScheduled={load}
        extraFields={(
          <>
            <div className="visit-form-search">
              <label className="search-field">
                <Icon name="search" size={16} />
                <input
                  placeholder="Filtrar chamados"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
            </div>
            <Field label="Chamado">
              <select value={chamadoId} onChange={(e) => setChamadoId(e.target.value)} required>
                <option value="">{loading ? 'Carregando…' : 'Selecione o chamado'}</option>
                {opcoes.map((row) => (
                  <option key={row.id} value={row.id}>
                    {chamadoNumero(row.numero_registro)} · {row.titulo}
                    {row.unidades?.identificacao ? ` · ${row.unidades.identificacao}` : ''}
                    {` · ${STATUS_LABEL[row.status] || row.status}`}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      />

      {loading && !visitas.length ? (
        <Empty text="Carregando visitas agendadas…" />
      ) : !visitas.length ? (
        <Empty text="Nenhuma visita agendada neste condomínio." />
      ) : (
        <div className="visit-lists">
          <section>
            <h2 className="visit-section-title">Próximas visitas</h2>
            {!proximas.length ? (
              <p className="hint">Nenhuma visita futura.</p>
            ) : (
              <div className="visit-list">
                {proximas.map((visita) => <VisitCard key={visita.id} visita={visita} />)}
              </div>
            )}
          </section>
          {anteriores.length ? (
            <section>
              <h2 className="visit-section-title">Anteriores</h2>
              <div className="visit-list">
                {anteriores.map((visita) => <VisitCard key={visita.id} visita={visita} />)}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </Page>
  );
}
