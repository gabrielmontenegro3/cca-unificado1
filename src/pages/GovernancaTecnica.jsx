import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can, ehCargoConstrutora, CRITICIDADE_LAUDO } from '../lib/permissions';
import { chamadoNumero, rotuloLaudoUnidade } from '../lib/format';
import {
  anexarArquivosNasMensagens,
  atualizarCriticidadeLaudo,
  carregarLaudoGovernanca,
  enviarArquivoLaudo,
  enviarMensagemLaudo,
  garantirChatLaudo,
  hidratarNomesMensagens,
  juntarMensagensComAberturaLaudo,
  hidratarFotosMensagens,
  listarLaudosGovernanca,
} from '../lib/api';
import {
  classeListaConversa,
  mapaLeituraConversas,
  marcarConversaLidaPorLaudo,
} from '../lib/notifications';
import { Alert, Btn, Empty } from '../components/ui';
import { Icon } from '../components/icons';
import { ChatComposer, ChatHeader, CriticidadeTag, LaudoThread, LaudoThumb } from '../components/Chat';
import { UnreadOrb } from '../components/UnreadOrb';

export function GovernancaTecnicaPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { condoId, cargoTipo, session } = useSession();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [laudo, setLaudo] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const [leitura, setLeitura] = useState({});
  const [lidaAte, setLidaAte] = useState(null);
  const chatLogRef = useRef(null);
  const canView = can(cargoTipo, 'view_laudos');
  const canChat = can(cargoTipo, 'chat_laudo');
  const canCreate = can(cargoTipo, 'create_laudo');
  const ehConstrutora = ehCargoConstrutora(cargoTipo);

  async function loadLista() {
    if (!condoId) return;
    try {
      const data = await listarLaudosGovernanca(condoId);
      setRows(data);
      const map = await mapaLeituraConversas();
      setLeitura(map.byLaudo || {});
      setError('');
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os laudos.');
      setRows([]);
    }
  }

  async function loadChat(laudoId) {
    if (!laudoId) {
      setLaudo(null);
      setMensagens([]);
      setLidaAte(null);
      return;
    }
    try {
      const data = await carregarLaudoGovernanca(laudoId);
      if (!data) {
        setError('Laudo não encontrado.');
        setLaudo(null);
        setMensagens([]);
        return;
      }
      setLaudo(data);
      setError('');
      const convId = canChat
        ? await garantirChatLaudo(laudoId, session.user.id)
        : (await supabase.from('conversas').select('id').eq('laudo_id', laudoId).maybeSingle()).data?.id;
      if (!convId) {
        setMensagens([]);
        return;
      }
      const part = await supabase
        .from('conversa_participantes')
        .select('ultima_leitura_em')
        .eq('conversa_id', convId)
        .eq('usuario_id', session.user.id)
        .maybeSingle();
      setLidaAte(part.data?.ultima_leitura_em || null);
      const msgs = await supabase
        .from('mensagens')
        .select('*, usuarios:usuario_id(nome)')
        .eq('conversa_id', convId)
        .order('created_at');
      const withFiles = await anexarArquivosNasMensagens(msgs.data || []);
      const joined = await juntarMensagensComAberturaLaudo(data, withFiles);
      const named = await hidratarNomesMensagens(joined, {
        condominioId: data.condominio_id || condoId,
      });
      setMensagens(await hidratarFotosMensagens(named.mensagens));
      await marcarConversaLidaPorLaudo(laudoId);
      const map = await mapaLeituraConversas();
      setLeitura(map.byLaudo || {});
    } catch (chatErr) {
      setError(chatErr.message || '');
      setLaudo(null);
      setMensagens([]);
    }
  }

  useEffect(() => {
    if (!canView || !condoId) return;
    loadLista();
  }, [condoId, canView]);

  useEffect(() => {
    if (!canView) return;
    loadChat(id);
  }, [id, canView, session.user.id]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return undefined;
    const notas = mensagens.filter((m) => !m.abertura);
    const go = () => {
      el.scrollTop = notas.length ? el.scrollHeight : 0;
    };
    go();
    const t = setTimeout(go, 250);
    return () => clearTimeout(t);
  }, [mensagens]);

  const filtrados = useMemo(() => rows.filter((row) => {
    const text = `${rotuloLaudoUnidade(row)} ${row.chamado_numero || row.chamados?.numero_registro || ''} ${row.criticidade || ''}`.toLowerCase();
    return text.includes(q.toLowerCase());
  }), [rows, q]);

  async function mudarCriticidade(valor) {
    if (!id || !canCreate) return;
    try {
      await atualizarCriticidadeLaudo(id, valor);
      await Promise.all([loadChat(id), loadLista()]);
    } catch (err) {
      setError(err.message || 'Não foi possível atualizar a criticidade.');
    }
  }

  async function send(e) {
    e.preventDefault();
    const body = texto.trim();
    if (!body || !id || sending || !canChat) return;
    setSending(true);
    setError('');
    try {
      await enviarMensagemLaudo(id, body, session.user.id);
      setTexto('');
      await Promise.all([loadChat(id), loadLista()]);
    } catch (err) {
      setError(err.message || 'Não foi possível enviar.');
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file) {
    if (!file || !id || !canChat) return;
    setSending(true);
    setError('');
    try {
      await enviarArquivoLaudo({
        laudoId: id,
        condominioId: condoId || laudo?.condominio_id,
        userId: session.user.id,
        file,
      });
      await Promise.all([loadChat(id), loadLista()]);
    } catch (err) {
      setError(err.message || 'Não foi possível enviar o arquivo.');
    } finally {
      setSending(false);
    }
  }

  if (!canView) return <Navigate to="/visao-geral" replace />;

  return (
    <main className="page page-suporte page-governanca">
      <header className="page-head">
        <div>
          <h1>Governança técnica</h1>
          <p>
            {ehConstrutora
              ? 'Laudos e conversa com a Gestão Técnica. Esta é a tela principal da construtora.'
              : 'Laudos técnicos e chat com a Construtora, vinculados aos chamados.'}
          </p>
        </div>
        {canCreate ? <Btn to="/laudos/novo" icon="plus">Novo laudo</Btn> : null}
      </header>
      <div className="page-body">
        <Alert error={error} />
        <div className="row" style={{ marginBottom: 16 }}>
          <label className="search-field">
            <Icon name="search" size={16} />
            <input placeholder="Pesquisar unidade ou chamado" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        <div className="suporte-layout">
          <aside className="panel suporte-list">
            {!filtrados.length ? <Empty text="Nenhum laudo ainda." /> : filtrados.map((row) => {
              const estado = leitura[row.id]?.estado || 'lida';
              const unread = estado === 'nova' || estado === 'nao_lida';
              return (
                <button
                  type="button"
                  key={row.id}
                  className={`suporte-item laudo-item${row.id === id ? ' active' : ''} ${classeListaConversa(estado)}`.trim()}
                  onClick={() => navigate(`/governanca-tecnica/${row.id}`)}
                >
                  {unread ? (
                    <UnreadOrb
                      count={leitura[row.id]?.nao_lidas || 1}
                      variant={estado === 'nova' ? 'nova' : 'alerta'}
                      title={estado === 'nova' ? 'Conversa nova' : 'Mensagens novas'}
                      onClick={() => navigate(`/governanca-tecnica/${row.id}`)}
                    />
                  ) : null}
                  <LaudoThumb capa={row.capa} />
                  <div className="laudo-item-copy">
                    <strong className="suporte-item-name">{rotuloLaudoUnidade(row)}</strong>
                    <small className="suporte-item-preview">
                      {chamadoNumero(row.chamados?.numero_registro ?? row.chamado_numero)}
                    </small>
                    <CriticidadeTag value={row.criticidade} />
                  </div>
                </button>
              );
            })}
          </aside>
          <section className={`chat-shell laudo-shell suporte-chat${laudo ? '' : ' empty'}`}>
            {!laudo ? (
              <Empty text="Selecione um laudo para acompanhar." />
            ) : (
              <>
                <ChatHeader
                  icon="clipboard"
                  title={rotuloLaudoUnidade(laudo)}
                  subtitle={chamadoNumero(laudo.chamados?.numero_registro ?? laudo.chamado_numero)}
                >
                  {canCreate ? (
                    <label className="laudo-crit-select">
                      <span>Criticidade</span>
                      <select
                        value={String(laudo.criticidade || 'media').toLowerCase()}
                        onChange={(e) => mudarCriticidade(e.target.value)}
                      >
                        {CRITICIDADE_LAUDO.map((item) => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <CriticidadeTag value={laudo.criticidade} />
                  )}
                  {laudo.chamados && can(cargoTipo, 'view_all_tickets') ? (
                    <Btn
                      variant="ghost"
                      icon="message"
                      onClick={() => navigate(`/chamados/${laudo.chamados.id}`)}
                    >
                      Ver chamado
                    </Btn>
                  ) : null}
                </ChatHeader>
                <div className="chat-log laudo-log" ref={chatLogRef}>
                  <LaudoThread
                    mensagens={mensagens}
                    sessionUserId={session.user.id}
                    lidaAte={lidaAte}
                    empty="Nenhuma nota ainda."
                  />
                </div>
                {canChat ? (
                  <ChatComposer
                    value={texto}
                    onChange={setTexto}
                    sending={sending}
                    onSend={send}
                    onFile={sendFile}
                    placeholder={ehConstrutora ? 'Escreva uma nota para a Gestão Técnica' : 'Escreva uma nota para a Construtora'}
                  />
                ) : (
                  <p className="hint" style={{ padding: '0 16px 16px' }}>Somente Gestão Técnica e Construtora acompanham este laudo.</p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
