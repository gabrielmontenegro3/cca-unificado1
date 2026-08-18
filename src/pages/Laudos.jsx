import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can } from '../lib/permissions';
import { chamadoNumero, formatChatTime, formatDate, laudoNumero } from '../lib/format';
import {
  criarLaudo,
  garantirChatLaudo,
  anexarArquivosNasMensagens,
  enviarMensagemLaudo,
  enviarArquivoLaudo,
} from '../lib/api';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';
import { ChatComposer, ChatHeader, ChatMensagem } from '../components/Chat';

export function LaudosPage() {
  const { condoId, cargoTipo } = useSession();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const canCreate = can(cargoTipo, 'create_laudo');
  const canView = can(cargoTipo, 'view_laudos');

  useEffect(() => {
    if (!condoId || !canView) return;
    supabase
      .from('laudos_tecnicos')
      .select('*, chamados(numero_registro, titulo), usuarios:criado_por(nome)')
      .eq('condominio_id', condoId)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setRows(data || []);
      });
  }, [condoId, canView]);

  if (!canView) return <Navigate to="/chamados" replace />;

  return (
    <Page
      title="Laudos técnicos"
      lead="Registro formal ligado a um chamado. O chat é entre Gestão Técnica e Construtora."
      actions={canCreate ? <Btn to="/laudos/novo" icon="plus">Novo laudo</Btn> : null}
    >
      <Alert error={error} />
      <div className="table-wrap panel">
        {!rows.length ? <Empty text="Nenhum laudo." /> : (
          <table>
            <thead><tr><th>Nº</th><th>Título</th><th>Chamado</th><th>Data</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><Link to={`/laudos/${row.id}`}>{laudoNumero(row.numero_registro)}</Link></td>
                  <td>{row.titulo}</td>
                  <td>{row.chamados ? `${chamadoNumero(row.chamados.numero_registro)} · ${row.chamados.titulo || ''}` : '—'}</td>
                  <td>{formatDate(row.data_laudo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}

export function LaudoNovoPage() {
  const { condoId, session, cargoTipo } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [chamados, setChamados] = useState([]);
  const [form, setForm] = useState({ titulo: '', descricao: '', chamado_id: params.get('chamado') || '' });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!condoId) return;
    supabase
      .from('chamados')
      .select('id, numero_registro, titulo, status')
      .eq('condominio_id', condoId)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setChamados(data || []);
      });
  }, [condoId]);

  if (!can(cargoTipo, 'view_laudos')) return <Navigate to="/chamados" replace />;
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
        titulo: form.titulo,
        descricao: form.descricao,
        files,
      });
      navigate(`/laudos/${laudo.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Novo laudo" lead="Vincule o laudo a um chamado deste condomínio.">
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
                {chamadoNumero(c.numero_registro)} · {c.titulo}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Título"><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required /></Field>
        <Field label="Descrição"><textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></Field>
        <Field label="Arquivos"><input type="file" multiple onChange={(e) => setFiles([...e.target.files])} /></Field>
        <Btn type="submit" icon="clipboard" disabled={busy}>{busy ? 'Criando…' : 'Criar laudo'}</Btn>
      </form>
    </Page>
  );
}

export function LaudoDetalhePage() {
  const { id } = useParams();
  const { condoId, cargoTipo, session } = useSession();
  const [row, setRow] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const chatLogRef = useRef(null);
  const canView = can(cargoTipo, 'view_laudos');
  const canChat = can(cargoTipo, 'chat_laudo');

  async function load() {
    const { data, error: err } = await supabase
      .from('laudos_tecnicos')
      .select('*, chamados(id, numero_registro, titulo), usuarios:criado_por(nome)')
      .eq('id', id)
      .single();
    if (err) {
      setError(err.message);
      setRow(null);
      return;
    }
    setRow(data);
    try {
      let convId = null;
      if (canChat) {
        convId = await garantirChatLaudo(id, session.user.id);
      } else {
        const conv = await supabase.from('conversas').select('id').eq('laudo_id', id).maybeSingle();
        convId = conv.data?.id || null;
      }
      if (!convId) {
        setMensagens([]);
        return;
      }
      const msgs = await supabase
        .from('mensagens')
        .select('*, usuarios(nome)')
        .eq('conversa_id', convId)
        .order('created_at');
      setMensagens(await anexarArquivosNasMensagens(msgs.data || []));
    } catch (chatErr) {
      const conv = await supabase.from('conversas').select('id').eq('laudo_id', id).maybeSingle();
      if (conv.data?.id) {
        const msgs = await supabase
          .from('mensagens')
          .select('*, usuarios(nome)')
          .eq('conversa_id', conv.data.id)
          .order('created_at');
        setMensagens(await anexarArquivosNasMensagens(msgs.data || []));
      } else {
        setError(chatErr.message || err.message || '');
      }
    }
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

  if (!canView) return <Navigate to="/chamados" replace />;

  async function send(e) {
    e.preventDefault();
    if (!canChat || sending) return;
    const body = texto.trim();
    if (!body) return;
    setSending(true);
    setError('');
    try {
      await enviarMensagemLaudo(id, body, session.user.id);
      setTexto('');
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file) {
    if (!file || !canChat) return;
    setSending(true);
    setError('');
    try {
      await enviarArquivoLaudo({
        laudoId: id,
        condominioId: condoId || row?.condominio_id,
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

  if (!row) return <Page title="Laudo"><Alert error={error} /></Page>;

  const visiveis = mensagens.filter((m) => !m.excluido_em);

  return (
    <div className="chamado-page">
      <Alert error={error} />
      <div className="chamado-layout">
        <aside className="chamado-side">
          <h2>{row.titulo}</h2>
          {row.descricao ? <p className="chamado-desc">{row.descricao}</p> : null}
          <dl className="chamado-meta">
            <div>
              <dt>Registro</dt>
              <dd>{laudoNumero(row.numero_registro)}</dd>
            </div>
            <div>
              <dt>Chamado</dt>
              <dd>
                {row.chamados ? (
                  <Link to={`/chamados/${row.chamados.id}`}>
                    {chamadoNumero(row.chamados.numero_registro)}
                    {row.chamados.titulo ? ` · ${row.chamados.titulo}` : ''}
                  </Link>
                ) : '—'}
              </dd>
            </div>
            <div>
              <dt>Criado por</dt>
              <dd>{row.usuarios?.nome || 'Gestão Técnica'}</dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>{formatDate(row.data_laudo)}</dd>
            </div>
          </dl>
        </aside>

        <section className="chat-shell">
          <ChatHeader
            title="Chat do laudo"
            subtitle="Gestão Técnica e Construtora"
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
            {!visiveis.length ? <Empty text="Nenhuma mensagem ainda." /> : null}
          </div>
          {canChat ? (
            <ChatComposer
              value={texto}
              onChange={setTexto}
              sending={sending}
              onSend={send}
              onFile={sendFile}
            />
          ) : (
            <p className="chat-readonly">Somente leitura. A Gestão Técnica e a Construtora conversam neste chat.</p>
          )}
        </section>
      </div>
    </div>
  );
}
