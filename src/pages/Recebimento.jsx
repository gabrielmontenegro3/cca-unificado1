import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { ehCargoConstrutora } from '../lib/permissions';
import { formatChatTime, formatDate } from '../lib/format';
import {
  STATUS_CHAT,
  TIPOS_RECEBIMENTO,
  agendarVistoriaUnidade,
  carregarChatUnidade,
  desmarcarUnidadeOk,
  enviarMensagemUnidade,
  listarChatsUnidades,
  marcarUnidadeOk,
  mensagemErroRecebimentoChat,
  unidadesDoMorador,
} from '../lib/recebimento';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';
import { Modal } from '../components/DataList';
import { Icon } from '../components/icons';
import { ChatComposer, ChatHeader, ChatMensagem } from '../components/Chat';

/* ---------- Peças ---------- */

/** Selo da unidade: nada (sem vistoria), azul (com chat) ou verde com ✓ (OK). */
export function SeloRecebimento({ status }) {
  if (status === 'ok') {
    return (
      <span className="rec-selo is-ok" title="Entrega OK">
        <Icon name="check" size={13} />
        OK
      </span>
    );
  }
  if (status === 'chat') return <span className="rec-selo is-chat">Em andamento</span>;
  return <span className="rec-selo">Sem vistoria</span>;
}

function horaDe(valor) {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Eventos dentro do chat: vistoria agendada, OK da entrega e registros antigos. */
function EventoChat({ registro }) {
  if (registro.tipo === 'vistoria_agendada') {
    const hora = horaDe(registro.data_evento);
    return (
      <div className="chat-event chat-event--visita rec-evento-vistoria" role="status">
        <span className="chat-event-icon" aria-hidden="true"><Icon name="calendar" size={20} /></span>
        <div className="chat-event-copy">
          <strong>{registro.titulo || 'Vistoria agendada'}</strong>
          <span>Vistoria em {formatDate(registro.data_evento)}{hora ? ` às ${hora}` : ''}</span>
        </div>
        <time>{formatChatTime(registro.created_at || registro.data_evento)}</time>
      </div>
    );
  }
  if (registro.tipo === 'assinatura_entrega') {
    return (
      <div className="chat-event rec-evento-ok" role="status">
        <span className="rec-evento-ok-selo" aria-hidden="true"><Icon name="check" size={18} /></span>
        <div className="chat-event-copy">
          <strong>Entrega OK</strong>
          <span>Imóvel entregue sem pendências{registro.autorNome ? ` · ${registro.autorNome}` : ''}</span>
        </div>
        <time>{formatChatTime(registro.data_evento)}</time>
      </div>
    );
  }
  const meta = TIPOS_RECEBIMENTO[registro.tipo];
  return (
    <div className="chat-event rec-evento-antigo" role="status">
      <span className="chat-event-icon" aria-hidden="true"><Icon name={meta?.icon || 'clipboard'} size={18} /></span>
      <div className="chat-event-copy">
        <strong>{registro.titulo || meta?.label || 'Registro'}</strong>
        {registro.descricao ? <span>{registro.descricao}</span> : null}
      </div>
      <time>{formatChatTime(registro.data_evento)}</time>
    </div>
  );
}

function agoraLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function AgendarVistoriaModal({ open, unidade, busy, onClose, onSalvar }) {
  const [titulo, setTitulo] = useState('');
  const [quando, setQuando] = useState('');
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitulo('');
    setQuando(agoraLocal());
    setErro('');
  }, [open]);

  async function salvar(e) {
    e.preventDefault();
    if (!titulo.trim()) return setErro('Escreva o título da vistoria.');
    if (!quando) return setErro('Informe a data da vistoria.');
    await onSalvar({ titulo: titulo.trim(), dataEvento: new Date(quando).toISOString() });
  }

  return (
    <Modal
      open={open}
      title={`Agendar vistoria${unidade ? ` · ${unidade}` : ''}`}
      className="modal-sheet--trace rec-modal"
      onClose={busy ? undefined : onClose}
      footer={(
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Btn>
          <Btn type="submit" form="rec-agendar" icon="calendar" disabled={busy}>{busy ? 'Salvando…' : 'Agendar'}</Btn>
        </>
      )}
    >
      <form id="rec-agendar" className="stack" onSubmit={salvar}>
        <Alert error={erro} />
        <Field label="Título">
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Vistoria de entrega com o proprietário"
            autoFocus
          />
        </Field>
        <Field label="Data e hora da vistoria">
          <input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} required />
        </Field>
        <p className="hint">A vistoria aparece no chat desta unidade para a construtora e o morador.</p>
      </form>
    </Modal>
  );
}

/* ---------- Tela ---------- */

export function RecebimentoPage() {
  const { unidadeId } = useParams();
  const navigate = useNavigate();
  const { condoId, session, cargoTipo, isGestaoTecnica, isConstrutoraOrg } = useSession();
  const ehMorador = String(cargoTipo || '').toLowerCase() === 'morador';
  const ehConstrutora = isConstrutoraOrg || ehCargoConstrutora(cargoTipo);
  const podeEscrever = isGestaoTecnica || ehConstrutora;

  const [unidades, setUnidades] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [itens, setItens] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('');
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agendar, setAgendar] = useState(false);
  const chatLogRef = useRef(null);

  const aberta = unidades.find((u) => u.id === unidadeId) || null;

  async function loadLista() {
    if (!condoId) return;
    try {
      let somenteIds = null;
      if (ehMorador) {
        const minhas = await unidadesDoMorador(condoId, session.user.id);
        somenteIds = minhas.map((u) => u.id);
      }
      const lista = await listarChatsUnidades(condoId, { somenteIds });
      setUnidades(lista);
      setError('');
      // Morador com um só imóvel: abre direto o chat dele.
      if (ehMorador && !unidadeId && lista.length === 1) navigate(`/recebimento/${lista[0].id}`, { replace: true });
    } catch (err) {
      setError(mensagemErroRecebimentoChat(err));
    } finally {
      setCarregado(true);
    }
  }

  async function loadChat(id = unidadeId) {
    if (!id) {
      setItens([]);
      return;
    }
    try {
      setItens(await carregarChatUnidade(id));
    } catch (err) {
      setError(mensagemErroRecebimentoChat(err));
    }
  }

  useEffect(() => { loadLista(); }, [condoId, ehMorador, session?.user?.id]);
  useEffect(() => { loadChat(unidadeId); }, [unidadeId]);

  // Atualiza o chat aberto de tempos em tempos (mensagens da outra parte).
  useEffect(() => {
    if (!unidadeId) return undefined;
    const t = setInterval(() => { loadChat(unidadeId); loadLista(); }, 20000);
    return () => clearInterval(t);
  }, [unidadeId, condoId]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [itens]);

  const contagem = useMemo(() => {
    const c = {};
    for (const u of unidades) c[u.status] = (c[u.status] || 0) + 1;
    return c;
  }, [unidades]);

  const visiveis = unidades.filter((u) => (!filtro || u.status === filtro)
    && `${u.rotulo} ${u.preview}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function enviar(e) {
    e.preventDefault();
    if (!aberta || !texto.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await enviarMensagemUnidade({ unidadeId: aberta.id, condominioId: condoId, userId: session.user.id, texto });
      setTexto('');
      await Promise.all([loadChat(), loadLista()]);
    } catch (err) {
      setError(mensagemErroRecebimentoChat(err));
    } finally {
      setSending(false);
    }
  }

  async function enviarArquivo(file) {
    if (!aberta || !file) return;
    setSending(true);
    setError('');
    try {
      await enviarMensagemUnidade({ unidadeId: aberta.id, condominioId: condoId, userId: session.user.id, texto: '', files: [file] });
      await Promise.all([loadChat(), loadLista()]);
    } catch (err) {
      setError(mensagemErroRecebimentoChat(err));
    } finally {
      setSending(false);
    }
  }

  async function salvarVistoria({ titulo, dataEvento }) {
    setBusy(true);
    setError('');
    try {
      await agendarVistoriaUnidade({ condominioId: condoId, unidadeId: aberta.id, userId: session.user.id, titulo, dataEvento });
      setAgendar(false);
      await Promise.all([loadChat(), loadLista()]);
    } catch (err) {
      setError(mensagemErroRecebimentoChat(err));
      setAgendar(false);
    } finally {
      setBusy(false);
    }
  }

  async function alternarOk() {
    if (!aberta) return;
    const ok = aberta.status === 'ok';
    const pergunta = ok
      ? `Remover o OK de ${aberta.rotulo}? A unidade volta a ficar em andamento.`
      : `Marcar ${aberta.rotulo} como OK? Significa que a entrega foi concluída sem pendências.`;
    if (!window.confirm(pergunta)) return;
    setBusy(true);
    setError('');
    try {
      if (ok) await desmarcarUnidadeOk(aberta.id);
      else await marcarUnidadeOk({ condominioId: condoId, unidadeId: aberta.id, userId: session.user.id });
      await Promise.all([loadChat(), loadLista()]);
    } catch (err) {
      setError(mensagemErroRecebimentoChat(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Recebimento"
      lead={ehMorador
        ? 'Acompanhe a vistoria de entrega do seu imóvel. A conversa é entre a Gestão Técnica e a construtora.'
        : 'Um chat por unidade entre a Gestão Técnica e a construtora sobre a vistoria de entrega.'}
      className="page-suporte page-recebimento"
    >
      <Alert error={error} />
      {!ehMorador || unidades.length > 1 ? (
        <div className="row chamado-filters">
          <label className="search-field">
            <Icon name="search" size={16} />
            <input placeholder="Pesquisar unidade" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="">Todas ({unidades.length})</option>
            <option value="sem_vistoria">Sem vistoria ({contagem.sem_vistoria || 0})</option>
            <option value="chat">Em andamento ({contagem.chat || 0})</option>
            <option value="ok">OK ({contagem.ok || 0})</option>
          </select>
        </div>
      ) : null}

      <div className={`suporte-layout suporte-layout--mobile-nav${unidadeId ? ' suporte-layout--open' : ''}`}>
        <aside className="panel suporte-list rec-lista">
          {carregado && !visiveis.length ? (
            <Empty text={ehMorador ? 'Seu usuário ainda não está ligado a uma unidade.' : 'Nenhuma unidade encontrada.'} />
          ) : visiveis.map((u) => (
            <button
              type="button"
              key={u.id}
              className={`suporte-item rec-item is-${u.status}${u.id === unidadeId ? ' active' : ''}`}
              onClick={() => navigate(`/recebimento/${u.id}`)}
            >
              <div className="suporte-item-top">
                <strong className="suporte-item-name rec-item-nome">
                  {u.status === 'ok' ? <span className="rec-item-check" aria-hidden="true"><Icon name="check" size={12} /></span> : null}
                  {u.rotulo}
                </strong>
                <SeloRecebimento status={u.status} />
              </div>
              <small className="suporte-item-preview">
                {u.preview || (u.status === 'sem_vistoria' ? 'Nenhuma vistoria ainda' : STATUS_CHAT[u.status]?.label)}
              </small>
            </button>
          ))}
        </aside>

        <section className={`chat-shell suporte-chat${aberta ? '' : ' empty'}`}>
          {!aberta ? (
            <Empty text={carregado ? 'Selecione uma unidade para abrir o chat.' : 'Carregando…'} />
          ) : (
            <>
              <div className="chat-top">
                <button type="button" className="suporte-back" onClick={() => navigate('/recebimento')}>
                  <Icon name="chevron" size={18} />
                  Unidades
                </button>
                <ChatHeader
                  icon="door"
                  title={aberta.rotulo}
                  subtitle={aberta.status === 'ok' ? 'Entrega OK' : aberta.status === 'chat' ? 'Vistoria em andamento' : 'Sem vistoria'}
                >
                  <SeloRecebimento status={aberta.status} />
                  {isGestaoTecnica ? (
                    <Btn variant="ghost" icon="calendar" onClick={() => setAgendar(true)} disabled={busy}>
                      Agendar vistoria
                    </Btn>
                  ) : null}
                  {isGestaoTecnica ? (
                    <Btn
                      variant={aberta.status === 'ok' ? 'ghost' : 'primary'}
                      icon={aberta.status === 'ok' ? 'x' : 'check'}
                      className={aberta.status === 'ok' ? '' : 'rec-btn-ok'}
                      onClick={alternarOk}
                      disabled={busy}
                    >
                      {aberta.status === 'ok' ? 'Remover OK' : 'Marcar OK'}
                    </Btn>
                  ) : null}
                </ChatHeader>
              </div>
              <div className="chat-log" ref={chatLogRef}>
                {!itens.length ? (
                  <Empty text={isGestaoTecnica ? 'Nenhuma mensagem ainda. Comece agendando a vistoria.' : 'Nenhuma mensagem ainda.'} />
                ) : itens.map((item) => (item.kind === 'msg' ? (
                  <ChatMensagem
                    key={item.id}
                    mensagem={item.mensagem}
                    mine={item.mensagem.usuario_id === session?.user?.id}
                    quando={formatChatTime(item.at)}
                    mostrarNome
                  />
                ) : (
                  <EventoChat key={item.id} registro={item.registro} />
                )))}
              </div>
              {podeEscrever ? (
                <ChatComposer
                  value={texto}
                  onChange={setTexto}
                  sending={sending}
                  onSend={enviar}
                  onFile={enviarArquivo}
                  placeholder={isGestaoTecnica ? 'Escreva para a construtora' : 'Escreva para a Gestão Técnica'}
                />
              ) : (
                <p className="hint chat-readonly">Somente visualização</p>
              )}
            </>
          )}
        </section>
      </div>

      <AgendarVistoriaModal
        open={agendar}
        unidade={aberta?.rotulo}
        busy={busy}
        onClose={() => setAgendar(false)}
        onSalvar={salvarVistoria}
      />
    </Page>
  );
}

