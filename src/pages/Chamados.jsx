import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can, STATUS_CHAMADO, STATUS_LABEL } from '../lib/permissions';
import { chamadoNumero, formatChatTime, formatDateTime } from '../lib/format';
import { criarChamado, minhaUnidade, enviarMensagemChamado, garantirChatChamado, anexarArquivosNasMensagens, enviarArquivoChamado } from '../lib/api';
import { Alert, Badge, Btn, Empty, Field, Page } from '../components/ui';
import { Icon } from '../components/icons';
import { ChatComposer, ChatHeader, ChatMensagem } from '../components/Chat';
import { StatusPicker } from '../components/StatusPicker';

export function ChamadosPage() {
  const { condoId, cargoTipo, session } = useSession();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const all = can(cargoTipo, 'view_all_tickets');

  useEffect(() => {
    if (!condoId) return;
    let query = supabase
      .from('chamados')
      .select('*, usuarios:solicitante_id(nome), unidades(identificacao), locais(nome)')
      .eq('condominio_id', condoId)
      .order('created_at', { ascending: false });
    if (!all) query = query.eq('solicitante_id', session.user.id);
    query.then(({ data, error: err }) => {
      if (err) setError(err.message);
      setRows(data || []);
    });
  }, [condoId, all, session.user.id]);

  const filtered = rows.filter((row) => {
    const text = `${row.titulo} ${row.numero_registro}`.toLowerCase();
    return (!status || row.status === status) && text.includes(q.toLowerCase());
  });

  return (
    <Page
      title={all ? 'Chamados' : 'Meus chamados'}
      lead="Abra um atendimento e acompanhe a conversa com a equipe."
      actions={can(cargoTipo, 'create_ticket') ? <Btn to="/chamados/novo" icon="plus">Abrir chamado</Btn> : null}
    >
      <Alert error={error} />
      <div className="row chamado-filters">
        <label className="search-field">
          <Icon name="search" size={16} />
          <input placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_CHAMADO.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      {!filtered.length ? (
        <div className="panel"><Empty text="Nenhum chamado encontrado." /></div>
      ) : (
        <div className="ticket-list">
          {filtered.map((row) => (
            <Link className="ticket-card" key={row.id} to={`/chamados/${row.id}`}>
              <div className="ticket-card-top">
                <strong>{chamadoNumero(row.numero_registro)}</strong>
                <Badge value={row.status} />
              </div>
              <span className="ticket-card-title">{row.titulo}</span>
              <small>
                {row.unidades?.identificacao || 'Unidade'}
                {all && row.usuarios?.nome ? ` · ${row.usuarios.nome}` : ''}
                {' · '}
                {formatDateTime(row.updated_at)}
              </small>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

export function ChamadoNovoPage() {
  const { condoId, cargoTipo, session } = useSession();
  const navigate = useNavigate();
  const [unidade, setUnidade] = useState(null);
  const [unidadePronta, setUnidadePronta] = useState(false);
  const [form, setForm] = useState({ titulo: '', descricao: '' });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const podeAbrir = can(cargoTipo, 'create_ticket');

  useEffect(() => {
    if (!condoId || !podeAbrir) return;
    minhaUnidade(condoId)
      .then((row) => {
        setUnidade(row);
        setUnidadePronta(true);
      })
      .catch((err) => {
        setError(err.message);
        setUnidadePronta(true);
      });
  }, [condoId, podeAbrir]);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const chamado = await criarChamado({
        condominioId: condoId,
        userId: session.user.id,
        titulo: form.titulo,
        descricao: form.descricao,
        files,
      });
      navigate(`/chamados/${chamado.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!podeAbrir) {
    return (
      <Page title="Abrir chamado">
        <Alert error="Somente o morador pode abrir chamado." />
      </Page>
    );
  }

  return (
    <Page title="Abrir chamado" lead="Descreva o problema. Fotos ajudam a equipe técnica.">
      <Alert error={error} />
      <form className="panel stack" onSubmit={onSubmit}>
        <p className="hint">
          Unidade: <strong>{unidadePronta ? (unidade?.rotulo || 'Não cadastrada') : 'Carregando…'}</strong>
        </p>
        <Field label="Título"><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required /></Field>
        <Field label="Descrição"><textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} required /></Field>
        <Field label="Fotos ou documentos">
          <input type="file" multiple accept="image/*,.pdf" capture="environment" onChange={(e) => setFiles([...e.target.files])} />
        </Field>
        <Btn type="submit" icon="send" disabled={busy || !unidade?.id}>{busy ? 'Enviando…' : 'Registrar chamado'}</Btn>
      </form>
    </Page>
  );
}

export function ChamadoDetalhePage() {
  const { id } = useParams();
  const { condoId, cargoTipo, session } = useSession();
  const [chamado, setChamado] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [conversa, setConversa] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [laudo, setLaudo] = useState(null);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const chatLogRef = useRef(null);
  const canStatus = can(cargoTipo, 'change_status');
  const canLaudo = can(cargoTipo, 'create_laudo');

  async function load() {
    const { data, error: err } = await supabase
      .from('chamados')
      .select('*, usuarios:solicitante_id(nome), unidades(identificacao), locais(nome)')
      .eq('id', id)
      .single();
    if (err) return setError(err.message);
    setChamado(data);
    const hist = await supabase.from('chamado_status_historico').select('*, usuarios:alterado_por(nome)').eq('chamado_id', id).order('created_at');
    setHistorico(hist.data || []);
    const conv = await supabase.from('conversas').select('*').eq('chamado_id', id).maybeSingle();
    let convData = conv.data;
    if (!convData) {
      try {
        const convId = await garantirChatChamado(id, session.user.id);
        const created = await supabase.from('conversas').select('*').eq('id', convId).maybeSingle();
        convData = created.data || (convId ? { id: convId } : null);
      } catch {
        convData = null;
      }
    }
    setConversa(convData);
    if (convData?.id) {
      const msgs = await supabase.from('mensagens').select('*, usuarios(nome)').eq('conversa_id', convData.id).order('created_at');
      setMensagens(await anexarArquivosNasMensagens(msgs.data || []));
    }
    const lau = await supabase.from('laudos_tecnicos').select('id, numero_registro').eq('chamado_id', id).maybeSingle();
    setLaudo(lau.data);
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return undefined;
    const go = () => { el.scrollTop = el.scrollHeight; };
    go();
    const t = setTimeout(go, 250);
    return () => clearTimeout(t);
  }, [mensagens]);

  useEffect(() => {
    if (!conversa?.id) return undefined;
    const channel = supabase
      .channel(`chat-${conversa.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagens', filter: `conversa_id=eq.${conversa.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversa?.id]);

  async function send(e) {
    e.preventDefault();
    const body = texto.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      await enviarMensagemChamado(id, body, session.user.id);
      setTexto('');
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file) {
    if (!file) return;
    setSending(true);
    setError('');
    try {
      await enviarArquivoChamado({
        chamadoId: id,
        condominioId: condoId,
        userId: session.user.id,
        file,
      });
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível enviar o arquivo.');
    } finally {
      setSending(false);
    }
  }

  async function setTicketStatus(next) {
    if (!next || next === chamado.status) return;
    const { error: err } = await supabase.from('chamados').update({
      status: next,
      data_resolucao: next === 'resolvido' ? new Date().toISOString() : chamado.data_resolucao,
      resolvido_por: next === 'resolvido' ? session.user.id : chamado.resolvido_por,
    }).eq('id', id);
    if (err) return setError(err.message);
    await supabase.from('chamado_status_historico').insert({
      chamado_id: id,
      status_anterior: chamado.status,
      status_novo: next,
      alterado_por: session.user.id,
    });
    load();
  }

  if (!chamado) return <Page title="Chamado"><Alert error={error} /></Page>;

  const visiveis = mensagens.filter((m) => !m.excluido_em);

  return (
    <div className="chamado-page">
      <Alert error={error} />
      <div className="chamado-layout">
        <aside className="chamado-side">
          <StatusPicker value={chamado.status} editable={canStatus} onChange={setTicketStatus} />
          <h2>{chamado.titulo}</h2>
          {chamado.descricao ? <p className="chamado-desc">{chamado.descricao}</p> : null}
          <dl className="chamado-meta">
            <div>
              <dt>Solicitante</dt>
              <dd>{chamado.usuarios?.nome || '—'}</dd>
            </div>
            <div>
              <dt>Unidade</dt>
              <dd>{chamado.unidades?.identificacao || '—'}</dd>
            </div>
          </dl>
          {laudo && can(cargoTipo, 'view_laudos') ? <Link className="chamado-link" to={`/laudos/${laudo.id}`}>Laudo #{laudo.numero_registro}</Link> : null}
          {canLaudo && !laudo ? (
            <Btn to={`/laudos/novo?chamado=${chamado.id}`} icon="clipboard">Criar laudo</Btn>
          ) : null}
          {historico.length ? (
            <details className="chamado-tl">
              <summary>Histórico</summary>
              <div className="timeline">
                {historico.map((h) => (
                  <div className="tl-item" key={h.id}>
                    <span className="dot" />
                    <div>
                      <strong>{STATUS_LABEL[h.status_novo] || h.status_novo}</strong>
                      <div className="muted">{formatDateTime(h.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </aside>

        <section className="chat-shell">
          <ChatHeader
            title={chamado.titulo}
            subtitle={`${chamadoNumero(chamado.numero_registro)}${chamado.unidades?.identificacao ? ` · ${chamado.unidades.identificacao}` : ''}`}
          />
          <div className="chat-log" ref={chatLogRef}>
            {visiveis.map((m) => (
              <ChatMensagem
                key={m.id}
                mensagem={m}
                mine={m.usuario_id === session.user.id}
                quando={formatChatTime(m.created_at)}
              />
            ))}
            {!visiveis.length ? <Empty text="Envie a primeira mensagem." /> : null}
          </div>
          <ChatComposer
            value={texto}
            onChange={setTexto}
            sending={sending}
            onSend={send}
            onFile={sendFile}
          />
        </section>
      </div>
    </div>
  );
}
