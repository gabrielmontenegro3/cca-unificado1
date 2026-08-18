import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { STATUS_CHAMADO, STATUS_LABEL } from '../lib/permissions';
import { chamadoNumero, formatChatTime, formatDateTime } from '../lib/format';
import { enviarMensagemChamado, garantirChatChamado, anexarArquivosNasMensagens, enviarArquivoChamado } from '../lib/api';
import { Alert, Badge, Btn, Empty } from '../components/ui';
import { Icon } from '../components/icons';
import { GestaoBar } from '../components/GestaoBar';
import { ChatComposer, ChatHeader, ChatMensagem } from '../components/Chat';
import { StatusPicker } from '../components/StatusPicker';

export function SuportePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isGestaoTecnica, memberships, session, selectCondo } = useSession();
  const [rows, setRows] = useState([]);
  const [condoFiltro, setCondoFiltro] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [chamado, setChamado] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const chatLogRef = useRef(null);

  const condos = useMemo(() => {
    const list = (memberships || [])
      .map((row) => row.condominios)
      .filter((condo) => condo?.id);
    return [...new Map(list.map((condo) => [condo.id, condo])).values()]
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  }, [memberships]);

  async function loadLista() {
    let { data, error: err } = await supabase
      .from('chamados')
      .select('*, usuarios:solicitante_id(nome), unidades(identificacao), condominios(id, nome)')
      .order('updated_at', { ascending: false });
    if (err) {
      const plain = await supabase
        .from('chamados')
        .select('*, usuarios:solicitante_id(nome), unidades(identificacao)')
        .order('updated_at', { ascending: false });
      data = plain.data;
      err = plain.error;
    }
    if (err) setError(err.message);
    setRows(data || []);
  }

  async function loadChat(chamadoId) {
    if (!chamadoId) {
      setChamado(null);
      setMensagens([]);
      return;
    }
    const { data, error: err } = await supabase
      .from('chamados')
      .select('*, usuarios:solicitante_id(nome), unidades(identificacao), condominios(id, nome)')
      .eq('id', chamadoId)
      .single();
    if (err) {
      setError(err.message);
      setChamado(null);
      setMensagens([]);
      return;
    }
    setChamado(data);
    try {
      const convId = await garantirChatChamado(chamadoId, session.user.id);
      const msgs = await supabase
        .from('mensagens')
        .select('*, usuarios(nome)')
        .eq('conversa_id', convId)
        .order('created_at');
      setMensagens(await anexarArquivosNasMensagens(msgs.data || []));
    } catch (chatErr) {
      const conv = await supabase.from('conversas').select('id').eq('chamado_id', chamadoId).maybeSingle();
      if (conv.data?.id) {
        const msgs = await supabase
          .from('mensagens')
          .select('*, usuarios(nome)')
          .eq('conversa_id', conv.data.id)
          .order('created_at');
        setMensagens(await anexarArquivosNasMensagens(msgs.data || []));
      } else {
        setMensagens([]);
        setError(chatErr.message || '');
      }
    }
  }

  useEffect(() => {
    if (!isGestaoTecnica) return;
    loadLista();
  }, [isGestaoTecnica]);

  useEffect(() => {
    if (!isGestaoTecnica) return;
    loadChat(id);
  }, [id, isGestaoTecnica, session.user.id]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return undefined;
    const go = () => { el.scrollTop = el.scrollHeight; };
    go();
    const t = setTimeout(go, 250);
    return () => clearTimeout(t);
  }, [mensagens]);

  const filtrados = rows.filter((row) => {
    const text = `${row.titulo} ${row.numero_registro} ${row.usuarios?.nome || ''} ${row.condominios?.nome || ''}`.toLowerCase();
    return (!condoFiltro || row.condominio_id === condoFiltro)
      && (!status || row.status === status)
      && text.includes(q.toLowerCase());
  });

  const grupos = useMemo(() => {
    const map = new Map();
    for (const row of filtrados) {
      const key = row.condominio_id || 'sem';
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          nome: row.condominios?.nome || condos.find((c) => c.id === key)?.nome || 'Condomínio',
          items: [],
        });
      }
      map.get(key).items.push(row);
    }
    return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [filtrados, condos]);

  async function send(e) {
    e.preventDefault();
    const body = texto.trim();
    if (!body || !id || sending) return;
    setSending(true);
    setError('');
    try {
      await enviarMensagemChamado(id, body, session.user.id);
      setTexto('');
      await Promise.all([loadChat(id), loadLista()]);
    } catch (err) {
      setError(err.message || 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file) {
    if (!file || !chamado) return;
    setSending(true);
    setError('');
    try {
      await enviarArquivoChamado({
        chamadoId: chamado.id,
        condominioId: chamado.condominio_id,
        userId: session.user.id,
        file,
      });
      await Promise.all([loadChat(chamado.id), loadLista()]);
    } catch (err) {
      setError(err.message || 'Não foi possível enviar o arquivo.');
    } finally {
      setSending(false);
    }
  }

  if (!isGestaoTecnica) {
    return (
      <div className="portal">
        <Alert error="Somente a Gestão Técnica acessa o suporte global." />
      </div>
    );
  }

  return (
    <div className="portal">
      <GestaoBar />
      <main className="portal-main wide">
        <div className="page-head">
          <h1>Suporte</h1>
          <p>Todos os chats dos condomínios. Filtre por empreendimento ou abra um atendimento.</p>
        </div>
        <Alert error={error} />
        <div className="row" style={{ marginBottom: 16 }}>
          <select value={condoFiltro} onChange={(e) => setCondoFiltro(e.target.value)}>
            <option value="">Todos os condomínios</option>
            {condos.map((condo) => (
              <option key={condo.id} value={condo.id}>{condo.nome}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos os status</option>
            {STATUS_CHAMADO.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <label className="search-field">
            <Icon name="search" size={16} />
            <input placeholder="Pesquisar chamado, morador ou condomínio" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        <div className="suporte-layout">
          <aside className="panel suporte-list">
            {!grupos.length ? <Empty text="Nenhum suporte encontrado." /> : grupos.map((grupo) => (
              <section className="suporte-group" key={grupo.id}>
                {!condoFiltro ? <h3>{grupo.nome}</h3> : null}
                {grupo.items.map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    className={`suporte-item${row.id === id ? ' active' : ''}`}
                    onClick={() => navigate(`/suporte/${row.id}`)}
                  >
                    <div className="suporte-item-top">
                      <strong>{chamadoNumero(row.numero_registro)}</strong>
                      <Badge value={row.status} />
                    </div>
                    <span>{row.titulo}</span>
                    <small>
                      {condoFiltro ? null : `${row.condominios?.nome || 'Condomínio'} · `}
                      {row.usuarios?.nome || 'Morador'}
                      {row.unidades?.identificacao ? ` · ${row.unidades.identificacao}` : ''}
                      {' · '}
                      {formatDateTime(row.updated_at)}
                    </small>
                  </button>
                ))}
              </section>
            ))}
          </aside>

          <section className={`chat-shell suporte-chat${chamado ? '' : ' empty'}`}>
            {!chamado ? (
              <Empty text="Selecione um chamado para ver o chat." />
            ) : (
              <>
                <ChatHeader
                  title={chamado.titulo}
                  subtitle={`${chamadoNumero(chamado.numero_registro)} · ${chamado.condominios?.nome || 'Condomínio'}${chamado.unidades?.identificacao ? ` · ${chamado.unidades.identificacao}` : ''}`}
                >
                  <StatusPicker
                    value={chamado.status}
                    editable
                    onChange={async (next) => {
                      if (!next || next === chamado.status) return;
                      const { error: err } = await supabase.from('chamados').update({
                        status: next,
                        data_resolucao: next === 'resolvido' ? new Date().toISOString() : chamado.data_resolucao,
                        resolvido_por: next === 'resolvido' ? session.user.id : chamado.resolvido_por,
                      }).eq('id', chamado.id);
                      if (err) return setError(err.message);
                      await supabase.from('chamado_status_historico').insert({
                        chamado_id: chamado.id,
                        status_anterior: chamado.status,
                        status_novo: next,
                        alterado_por: session.user.id,
                      });
                      loadChat(chamado.id);
                      loadLista();
                    }}
                  />
                  <Btn
                    variant="ghost"
                    icon="building"
                    onClick={() => {
                      selectCondo(chamado.condominio_id);
                      navigate(`/chamados/${chamado.id}`);
                    }}
                  >
                    Abrir no condomínio
                  </Btn>
                </ChatHeader>
                <div className="chat-log" ref={chatLogRef}>
                  {mensagens.filter((m) => !m.excluido_em).map((m) => (
                    <ChatMensagem
                      key={m.id}
                      mensagem={m}
                      mine={m.usuario_id === session.user.id}
                      quando={formatChatTime(m.created_at)}
                    />
                  ))}
                  {!mensagens.length ? <Empty text="Nenhuma mensagem ainda." /> : null}
                </div>
                <ChatComposer
                  value={texto}
                  onChange={setTexto}
                  sending={sending}
                  onSend={send}
                  onFile={sendFile}
                />
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
