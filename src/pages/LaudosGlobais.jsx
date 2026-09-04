import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { chamadoNumero, formatChatTime, formatDateTime, laudoNumero } from '../lib/format';
import { anexarArquivosNasMensagens, enviarArquivoLaudo, enviarMensagemLaudo, garantirChatLaudo } from '../lib/api';
import {
  classeListaConversa,
  mapaLeituraConversas,
  marcarConversaLidaPorLaudo,
  mensagemEhNova,
} from '../lib/notifications';
import { Alert, Btn, Empty } from '../components/ui';
import { Icon } from '../components/icons';
import { GestaoBar } from '../components/GestaoBar';
import { ChatComposer, ChatHeader, ChatMensagem } from '../components/Chat';
import { UnreadOrb } from '../components/UnreadOrb';

export function LaudosGlobaisPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isGestaoTecnica, memberships, session, selectCondo } = useSession();
  const [rows, setRows] = useState([]);
  const [condoFiltro, setCondoFiltro] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [laudo, setLaudo] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const [leitura, setLeitura] = useState({});
  const [lidaAte, setLidaAte] = useState(null);
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
      .from('laudos_tecnicos')
      .select('*, chamados(id, numero_registro, titulo), usuarios:criado_por(nome), condominios(id, nome)')
      .order('created_at', { ascending: false });
    if (err) {
      const plain = await supabase
        .from('laudos_tecnicos')
        .select('*, chamados(id, numero_registro, titulo), usuarios:criado_por(nome)')
        .order('created_at', { ascending: false });
      data = plain.data;
      err = plain.error;
    }
    if (err) setError(err.message);
    setRows(data || []);
    try {
      const map = await mapaLeituraConversas();
      setLeitura(map.byLaudo || {});
    } catch {
      setLeitura({});
    }
  }

  async function loadChat(laudoId) {
    if (!laudoId) {
      setLaudo(null);
      setMensagens([]);
      setLidaAte(null);
      return;
    }
    const { data, error: err } = await supabase
      .from('laudos_tecnicos')
      .select('*, chamados(id, numero_registro, titulo), usuarios:criado_por(nome), condominios(id, nome)')
      .eq('id', laudoId)
      .single();
    if (err) {
      setError(err.message);
      setLaudo(null);
      setMensagens([]);
      return;
    }
    setLaudo(data);
    try {
      const convId = await garantirChatLaudo(laudoId, session.user.id);
      const part = await supabase
        .from('conversa_participantes')
        .select('ultima_leitura_em')
        .eq('conversa_id', convId)
        .eq('usuario_id', session.user.id)
        .maybeSingle();
      setLidaAte(part.data?.ultima_leitura_em || null);
      const msgs = await supabase
        .from('mensagens')
        .select('*, usuarios(nome)')
        .eq('conversa_id', convId)
        .order('created_at');
      setMensagens(await anexarArquivosNasMensagens(msgs.data || []));
      await marcarConversaLidaPorLaudo(laudoId);
      const map = await mapaLeituraConversas();
      setLeitura(map.byLaudo || {});
    } catch (chatErr) {
      const conv = await supabase.from('conversas').select('id').eq('laudo_id', laudoId).maybeSingle();
      if (conv.data?.id) {
        const msgs = await supabase
          .from('mensagens')
          .select('*, usuarios(nome)')
          .eq('conversa_id', conv.data.id)
          .order('created_at');
        setMensagens(await anexarArquivosNasMensagens(msgs.data || []));
        await marcarConversaLidaPorLaudo(laudoId);
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
    const text = `${row.titulo} ${row.numero_registro} ${row.usuarios?.nome || ''} ${row.condominios?.nome || ''} ${row.chamados?.titulo || ''}`.toLowerCase();
    return (!condoFiltro || row.condominio_id === condoFiltro) && text.includes(q.toLowerCase());
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
      await enviarMensagemLaudo(id, body, session.user.id);
      setTexto('');
      await Promise.all([loadChat(id), loadLista()]);
    } catch (err) {
      setError(err.message || 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file) {
    if (!file || !laudo) return;
    setSending(true);
    setError('');
    try {
      await enviarArquivoLaudo({
        laudoId: laudo.id,
        condominioId: laudo.condominio_id,
        userId: session.user.id,
        file,
      });
      await Promise.all([loadChat(laudo.id), loadLista()]);
    } catch (err) {
      setError(err.message || 'Não foi possível enviar o arquivo.');
    } finally {
      setSending(false);
    }
  }

  if (!isGestaoTecnica) {
    return (
      <div className="portal">
        <Alert error="Somente a Gestão Técnica acessa os laudos globais." />
      </div>
    );
  }

  return (
    <div className="portal">
      <GestaoBar />
      <main className="portal-main wide">
        <div className="page-head">
          <h1>Laudo técnico</h1>
        </div>
        <Alert error={error} />
        <div className="row" style={{ marginBottom: 16 }}>
          <select value={condoFiltro} onChange={(e) => setCondoFiltro(e.target.value)}>
            <option value="">Todos os condomínios</option>
            {condos.map((condo) => (
              <option key={condo.id} value={condo.id}>{condo.nome}</option>
            ))}
          </select>
          <label className="search-field">
            <Icon name="search" size={16} />
            <input placeholder="Pesquisar laudo, chamado ou condomínio" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        <div className="suporte-layout">
          <aside className="panel suporte-list">
            {!grupos.length ? <Empty text="Nenhum laudo encontrado." /> : grupos.map((grupo) => (
              <section className="suporte-group" key={grupo.id}>
                {!condoFiltro ? <h3>{grupo.nome}</h3> : null}
                {grupo.items.map((row) => {
                  const estado = leitura[row.id]?.estado;
                  const unread = estado === 'nova' || estado === 'nao_lida';
                  return (
                  <button
                    type="button"
                    key={row.id}
                    className={`suporte-item${row.id === id ? ' active' : ''} ${classeListaConversa(estado)}`.trim()}
                    onClick={() => navigate(`/laudos-globais/${row.id}`)}
                  >
                    {unread ? (
                      <UnreadOrb
                        count={leitura[row.id]?.nao_lidas || 1}
                        variant={estado === 'nova' ? 'nova' : 'alerta'}
                        title={estado === 'nova' ? 'Conversa nova — abrir' : 'Mensagens novas — abrir'}
                        onClick={() => navigate(`/laudos-globais/${row.id}`)}
                      />
                    ) : null}
                    <div className="suporte-item-top">
                      <strong>{laudoNumero(row.numero_registro)}</strong>
                    </div>
                    <span>{row.titulo}</span>
                    <small>
                      {condoFiltro ? null : `${row.condominios?.nome || 'Condomínio'} · `}
                      {row.chamados ? `${chamadoNumero(row.chamados.numero_registro)} · ${row.chamados.titulo || ''}` : 'Sem chamado'}
                      {' · '}
                      {formatDateTime(row.updated_at || row.created_at)}
                    </small>
                  </button>
                  );
                })}
              </section>
            ))}
          </aside>

          <section className={`chat-shell suporte-chat${laudo ? '' : ' empty'}`}>
            {!laudo ? (
              <Empty text="Selecione um laudo para ver o chat." />
            ) : (
              <>
                <ChatHeader
                  title={laudo.titulo}
                  subtitle={`${laudoNumero(laudo.numero_registro)} · ${laudo.condominios?.nome || 'Condomínio'} · Gestão Técnica e Construtora`}
                >
                  <Btn
                    variant="ghost"
                    icon="building"
                    onClick={() => {
                      selectCondo(laudo.condominio_id);
                      navigate(`/laudos/${laudo.id}`);
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
                      isNew={mensagemEhNova(m, session.user.id, lidaAte)}
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
