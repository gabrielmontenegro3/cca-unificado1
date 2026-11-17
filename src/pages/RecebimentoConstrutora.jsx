import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { formatChatTime, formatDate } from '../lib/format';
import {
  carregarChatUnidade,
  enviarMensagemUnidade,
  listarChatsRecebimentoGlobal,
  mensagemErroRecebimentoChat,
} from '../lib/recebimento';
import { Alert, Btn, Empty } from '../components/ui';
import { Icon } from '../components/icons';
import { GestaoBar } from '../components/GestaoBar';
import { ChatComposer, ChatHeader, ChatMensagem } from '../components/Chat';
import { AnexosVistoria, SeloRecebimento } from './Recebimento';

function horaDe(valor) {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function EventoChatPortal({ registro }) {
  if (registro.tipo === 'assinatura_entrega') {
    return (
      <div className="chat-event rec-evento-ok" role="status">
        <span className="rec-evento-ok-selo" aria-hidden="true"><Icon name="check" size={18} /></span>
        <div className="chat-event-copy"><strong>Entrega OK</strong><span>Imóvel entregue sem pendências</span></div>
        <time>{formatChatTime(registro.data_evento)}</time>
      </div>
    );
  }
  const vistoria = registro.tipo === 'vistoria_agendada';
  return (
    <div className={`chat-event ${vistoria ? 'chat-event--visita rec-evento-vistoria' : 'rec-evento-antigo'}`} role="status">
      <span className="chat-event-icon" aria-hidden="true"><Icon name={vistoria ? 'calendar' : 'clipboard'} size={20} /></span>
      <div className="chat-event-copy">
        <strong>{registro.titulo || (vistoria ? 'Vistoria agendada' : 'Registro')}</strong>
        {vistoria ? <span>Vistoria em {formatDate(registro.data_evento)} às {horaDe(registro.data_evento)}</span> : registro.descricao ? <span>{registro.descricao}</span> : null}
        {vistoria && registro.descricao ? <p className="rec-evento-descricao">{registro.descricao}</p> : null}
        <AnexosVistoria anexos={registro.arquivos} />
      </div>
      <time>{formatChatTime(registro.created_at || registro.data_evento)}</time>
    </div>
  );
}

/** Construtora: os chats de recebimento (um por unidade) de todos os condomínios. */
export function RecebimentoConstrutoraPage() {
  const { registroId: unidadeId } = useParams();
  const navigate = useNavigate();
  const { isConstrutoraOrg, isGestaoTecnica, session, selectCondo } = useSession();
  const [chats, setChats] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [condoFiltro, setCondoFiltro] = useState('');
  const [situacao, setSituacao] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [itens, setItens] = useState([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const chatLogRef = useRef(null);

  const aberto = chats.find((c) => c.unidadeId === unidadeId) || null;

  async function loadLista() {
    try {
      setChats(await listarChatsRecebimentoGlobal());
      setError('');
    } catch (err) {
      setError(mensagemErroRecebimentoChat(err));
    } finally {
      setCarregado(true);
    }
  }

  async function loadChat(id = unidadeId) {
    if (!id) { setItens([]); return; }
    try {
      setItens(await carregarChatUnidade(id));
    } catch (err) {
      setError(mensagemErroRecebimentoChat(err));
    }
  }

  useEffect(() => { loadLista(); }, []);
  useEffect(() => { loadChat(unidadeId); }, [unidadeId]);
  useEffect(() => {
    if (!unidadeId) return undefined;
    const t = setInterval(() => { loadChat(unidadeId); loadLista(); }, 20000);
    return () => clearInterval(t);
  }, [unidadeId]);
  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [itens]);

  const condos = useMemo(() => {
    const mapa = new Map(chats.map((c) => [c.condominioId, c.condominio]));
    return [...mapa.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR'));
  }, [chats]);

  const filtrados = chats.filter((c) => (!condoFiltro || c.condominioId === condoFiltro)
    && (!situacao || c.status === situacao)
    && `${c.rotulo} ${c.condominio} ${c.preview}`.toLowerCase().includes(q.trim().toLowerCase()));

  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const c of filtrados) {
      if (!mapa.has(c.condominioId)) mapa.set(c.condominioId, { id: c.condominioId, nome: c.condominio, items: [] });
      mapa.get(c.condominioId).items.push(c);
    }
    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [filtrados]);

  async function enviar(e) {
    e.preventDefault();
    if (!aberto || !texto.trim() || sending) return;
    setSending(true);
    try {
      await enviarMensagemUnidade({ unidadeId: aberto.unidadeId, condominioId: aberto.condominioId, userId: session.user.id, texto });
      setTexto('');
      await Promise.all([loadChat(), loadLista()]);
    } catch (err) {
      setError(mensagemErroRecebimentoChat(err));
    } finally {
      setSending(false);
    }
  }

  async function enviarArquivo(file) {
    if (!aberto || !file) return;
    setSending(true);
    try {
      await enviarMensagemUnidade({ unidadeId: aberto.unidadeId, condominioId: aberto.condominioId, userId: session.user.id, texto: '', files: [file] });
      await Promise.all([loadChat(), loadLista()]);
    } catch (err) {
      setError(mensagemErroRecebimentoChat(err));
    } finally {
      setSending(false);
    }
  }

  if (!isConstrutoraOrg && !isGestaoTecnica) {
    return <div className="portal"><Alert error="Somente a construtora acessa esta tela." /></div>;
  }

  return (
    <div className="portal">
      <GestaoBar variant={isConstrutoraOrg ? 'construtora' : 'gestao'} />
      <main className="portal-main wide">
        <div className="page-head">
          <h1>Recebimento</h1>
          <p>Chats da vistoria de entrega com a Gestão Técnica, um por unidade.</p>
        </div>
        <Alert error={error} />
        <div className="row" style={{ marginBottom: 16 }}>
          <select value={condoFiltro} onChange={(e) => setCondoFiltro(e.target.value)}>
            <option value="">Todos os condomínios</option>
            {condos.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
          <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            <option value="">Todas as situações</option>
            <option value="chat">Em andamento</option>
            <option value="ok">OK</option>
          </select>
          <label className="search-field">
            <Icon name="search" size={16} />
            <input placeholder="Pesquisar unidade ou condomínio" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        <div className="suporte-layout">
          <aside className="panel suporte-list rec-lista">
            {carregado && !grupos.length ? <Empty text="Nenhum chat de recebimento ainda." /> : grupos.map((grupo) => (
              <section className="suporte-group" key={grupo.id}>
                {!condoFiltro ? <h3>{grupo.nome}</h3> : null}
                {grupo.items.map((c) => (
                  <button
                    type="button"
                    key={c.unidadeId}
                    className={`suporte-item rec-item is-${c.status}${c.unidadeId === unidadeId ? ' active' : ''}`}
                    onClick={() => navigate(`/construtora-recebimento/${c.unidadeId}`)}
                  >
                    <div className="suporte-item-top">
                      <strong className="suporte-item-name rec-item-nome">
                        {c.status === 'ok' ? <span className="rec-item-check" aria-hidden="true"><Icon name="check" size={12} /></span> : null}
                        {c.rotulo}
                      </strong>
                      <SeloRecebimento status={c.status} />
                    </div>
                    <small className="suporte-item-preview">{c.preview || 'Vistoria agendada'}</small>
                  </button>
                ))}
              </section>
            ))}
          </aside>

          <section className={`chat-shell suporte-chat${aberto ? '' : ' empty'}`}>
            {!aberto ? (
              <Empty text="Selecione uma unidade para abrir o chat." />
            ) : (
              <>
                <div className="chat-top">
                  <ChatHeader icon="door" title={aberto.rotulo} subtitle={aberto.condominio}>
                    <SeloRecebimento status={aberto.status} />
                    <Btn
                      variant="ghost"
                      icon="building"
                      onClick={() => { selectCondo(aberto.condominioId); navigate(`/recebimento/${aberto.unidadeId}`); }}
                    >
                      Abrir no condomínio
                    </Btn>
                  </ChatHeader>
                </div>
                <div className="chat-log" ref={chatLogRef}>
                  {!itens.length ? <Empty text="Nenhuma mensagem ainda." /> : itens.map((item) => (item.kind === 'msg' ? (
                    <ChatMensagem
                      key={item.id}
                      mensagem={item.mensagem}
                      mine={item.mensagem.usuario_id === session?.user?.id}
                      quando={formatChatTime(item.at)}
                      mostrarNome
                    />
                  ) : <EventoChatPortal key={item.id} registro={item.registro} />))}
                </div>
                <ChatComposer
                  value={texto}
                  onChange={setTexto}
                  sending={sending}
                  onSend={enviar}
                  onFile={enviarArquivo}
                  placeholder="Escreva para a Gestão Técnica"
                />
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
