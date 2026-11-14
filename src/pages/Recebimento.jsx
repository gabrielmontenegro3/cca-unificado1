import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { ehCargoConstrutora } from '../lib/permissions';
import { formatDate, formatDateTime } from '../lib/format';
import {
  PAPEL_LABEL,
  STATUS_UNIDADE,
  TIPOS_RECEBIMENTO,
  carregarLinhaTempo,
  carregarUnidade,
  criarRegistro,
  enviarMensagemRecebimento,
  listarUnidadesRecebimento,
  marcarProblemaResolvido,
  mensagemErroRecebimento,
  statusDaUnidade,
  tiposPermitidos,
  tituloRegistro,
  unidadesDoMorador,
} from '../lib/recebimento';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';
import { Modal } from '../components/DataList';
import { Icon } from '../components/icons';
import { formatarTamanho } from '../components/ArquivoPreview';

/* ---------- Peças visuais ---------- */

export function StatusEntrega({ status }) {
  const info = STATUS_UNIDADE[status] || STATUS_UNIDADE.sem_vistoria;
  return <span className={`rec-status is-${info.tom}`}>{info.label}</span>;
}

export function GaleriaRecebimento({ arquivos }) {
  if (!arquivos?.length) return null;
  return (
    <div className="trace-gallery">
      {arquivos.map((arquivo) => (arquivo.isImage && arquivo.url ? (
        <figure key={arquivo.id} className="trace-gallery-item">
          <a href={arquivo.url} target="_blank" rel="noreferrer">
            <img src={arquivo.url} alt={arquivo.nome_original || 'Foto'} />
          </a>
        </figure>
      ) : arquivo.url ? (
        <a key={arquivo.id} className="trace-file" href={arquivo.url} target="_blank" rel="noreferrer">
          <Icon name="file" size={16} />
          {arquivo.nome_original || 'Arquivo'}
        </a>
      ) : null))}
    </div>
  );
}

function autorDe(item) {
  const papel = PAPEL_LABEL[item.autor_papel] || '';
  if (item.autorNome && papel) return `${item.autorNome} · ${papel}`;
  return item.autorNome || papel;
}

/** Mensagens do chat de um problema, em ordem, como uma mini linha do tempo. */
export function MensagensProblema({ mensagens, sessionUserId }) {
  if (!mensagens?.length) {
    return <p className="rec-chat-vazio">Nenhuma mensagem ainda.</p>;
  }
  return (
    <ol className="rec-chat-lista">
      {mensagens.map((m) => (
        <li
          key={m.id}
          className={`rec-msg is-${m.autor_papel || 'outro'}${m.usuario_id === sessionUserId ? ' is-minha' : ''}`}
        >
          <header>
            <strong>{autorDe(m) || 'Mensagem'}</strong>
            <time dateTime={m.created_at}>{formatDateTime(m.created_at)}</time>
          </header>
          {m.texto ? <p>{m.texto}</p> : null}
          <GaleriaRecebimento arquivos={m.arquivos} />
        </li>
      ))}
    </ol>
  );
}

/** Caixa de escrever no chat do problema (texto + anexos). */
export function ComposerProblema({ onEnviar, busy, placeholder }) {
  const [texto, setTexto] = useState('');
  const [files, setFiles] = useState([]);
  const fileRef = useRef(null);

  async function enviar(e) {
    e.preventDefault();
    if (!texto.trim() && !files.length) return;
    const ok = await onEnviar({ texto, files });
    if (ok !== false) {
      setTexto('');
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <form className="rec-composer" onSubmit={enviar}>
      {files.length ? (
        <ul className="rec-composer-arquivos">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`}>
              <Icon name={String(file.type).startsWith('image/') ? 'eye' : 'file'} size={14} />
              <span>{file.name}</span>
              <button type="button" aria-label={`Remover ${file.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="rec-composer-linha">
        <label className="chat-icon-btn" title="Anexar fotos ou arquivos">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.pdf"
            onChange={(e) => setFiles([...files, ...(e.target.files || [])])}
          />
          <Icon name="paperclip" />
        </label>
        <input
          className="chat-input"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          autoComplete="off"
        />
        <button className="chat-send" type="submit" disabled={busy || (!texto.trim() && !files.length)} title="Enviar">
          <Icon name="send" />
        </button>
      </div>
    </form>
  );
}

function CartaoRegistro({ registro, podeConversar, podeResolver, busy, sessionUserId, onEnviarMensagem, onResolver }) {
  const meta = TIPOS_RECEBIMENTO[registro.tipo] || {};
  const ehProblema = registro.tipo === 'problema';
  const [chatAberto, setChatAberto] = useState(!registro.resolvido);
  const quem = autorDe(registro);
  return (
    <article className={`trace-card rec-card rec-card--${registro.tipo}${registro.resolvido ? ' is-resolvido' : ''}`}>
      <header className="trace-card-head">
        <span className="trace-card-badge">
          <Icon name={meta.icon || 'clipboard'} size={12} />
          {meta.curto || 'Registro'}
        </span>
        <time dateTime={registro.data_evento}>{formatDateTime(registro.data_evento)}</time>
      </header>
      <h3 className="trace-card-title">{tituloRegistro(registro)}</h3>
      {quem ? <p className="trace-card-meta">Por {quem}</p> : null}
      {registro.descricao ? <p className="trace-card-text">{registro.descricao}</p> : null}
      <GaleriaRecebimento arquivos={registro.arquivos} />

      {ehProblema ? (
        <section className="rec-chat">
          <div className="rec-chat-head">
            <button type="button" className="rec-chat-toggle" onClick={() => setChatAberto((v) => !v)} aria-expanded={chatAberto}>
              <Icon name="message" size={15} />
              Conversa com a construtora
              <span className="rec-chat-count">{registro.mensagens.length}</span>
              <Icon name="chevron" size={14} className={`rec-chat-chevron${chatAberto ? ' is-open' : ''}`} />
            </button>
            {registro.resolvido ? (
              <span className="rec-status is-ok">
                Resolvido{registro.resolvido_em ? ` em ${formatDate(registro.resolvido_em)}` : ''}
              </span>
            ) : (
              <span className="rec-status is-alerta">Em aberto</span>
            )}
          </div>
          {chatAberto ? (
            <>
              <MensagensProblema mensagens={registro.mensagens} sessionUserId={sessionUserId} />
              {podeConversar ? (
                <ComposerProblema
                  busy={busy}
                  placeholder="Escreva para a construtora / Gestão Técnica"
                  onEnviar={(dados) => onEnviarMensagem(registro, dados)}
                />
              ) : null}
            </>
          ) : null}
          {podeResolver ? (
            <div className="rec-chat-acoes">
              <Btn
                variant="ghost"
                icon={registro.resolvido ? 'x' : 'check'}
                disabled={busy}
                onClick={() => onResolver(registro, !registro.resolvido)}
              >
                {registro.resolvido ? 'Reabrir problema' : 'Marcar como resolvido'}
              </Btn>
            </div>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

/* ---------- Modal de novo registro ---------- */

function agoraLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function NovoRegistroModal({ open, tipos, problemasAbertos, temVistoriaAgendada, onClose, onSalvar, busy, modoMorador }) {
  const [tipo, setTipo] = useState('');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [quando, setQuando] = useState('');
  const [files, setFiles] = useState([]);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!open) return;
    const inicial = tipos.includes('vistoria_agendada') && !temVistoriaAgendada ? 'vistoria_agendada' : tipos[0] || '';
    setTipo(inicial);
    setTitulo('');
    setDescricao('');
    setQuando(agoraLocal());
    setFiles([]);
    setErro('');
  }, [open]);

  const pedeTitulo = tipo === 'problema' || tipo === 'construtora';
  const assinaturaBloqueada = tipo === 'assinatura_entrega' && problemasAbertos > 0;

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    if (pedeTitulo && !titulo.trim()) {
      setErro(tipo === 'problema' ? 'Dê um título ao problema.' : 'Escreva o título do registro.');
      return;
    }
    if ((tipo === 'problema' || tipo === 'vistoria_solicitada') && !descricao.trim()) {
      setErro('Descreva o que foi encontrado.');
      return;
    }
    if (assinaturaBloqueada) {
      setErro('Resolva todos os problemas antes de registrar a assinatura de entrega.');
      return;
    }
    await onSalvar({
      tipo,
      titulo,
      descricao,
      dataEvento: quando ? new Date(quando).toISOString() : null,
      files,
    });
  }

  const tituloModal = modoMorador ? 'Solicitar vistoria' : 'Novo registro';

  return (
    <Modal
      open={open}
      title={tituloModal}
      onClose={busy ? undefined : onClose}
      className="modal-sheet--trace rec-modal"
      footer={(
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Btn>
          <Btn type="submit" form="rec-novo-registro" icon="check" disabled={busy || assinaturaBloqueada}>
            {busy ? 'Salvando…' : modoMorador ? 'Enviar solicitação' : 'Registrar'}
          </Btn>
        </>
      )}
    >
      <form id="rec-novo-registro" className="stack trace-form" onSubmit={salvar}>
        <Alert error={erro} />
        {modoMorador ? (
          <p className="hint">
            Descreva o que você quer que a Gestão Técnica verifique no seu imóvel e, se puder, anexe fotos.
            A solicitação aparece na linha do tempo.
          </p>
        ) : tipos.length > 1 ? (
          <Field label="Tipo de registro">
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {tipos.map((t) => <option key={t} value={t}>{TIPOS_RECEBIMENTO[t].label}</option>)}
            </select>
          </Field>
        ) : null}

        {tipo === 'problema' ? (
          <p className="hint">O problema abre uma conversa com a construtora, que fica dentro deste registro na linha do tempo.</p>
        ) : null}
        {assinaturaBloqueada ? (
          <Alert error={`Há ${problemasAbertos} problema(s) em aberto. Marque-os como resolvidos antes da assinatura de entrega.`} />
        ) : null}

        {pedeTitulo ? (
          <Field label={tipo === 'problema' ? 'Problema' : 'Título'}>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={tipo === 'problema' ? 'Ex.: Infiltração no teto do banheiro' : 'Ex.: Reparo agendado para segunda-feira'}
              autoFocus
            />
          </Field>
        ) : null}

        {!modoMorador ? (
          <Field label={tipo === 'vistoria_agendada' ? 'Data e hora da vistoria de entrega' : 'Data e hora'}>
            <input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} required />
          </Field>
        ) : null}

        <Field label="Descrição">
          <textarea
            value={descricao}
            rows={4}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={modoMorador ? 'Ex.: Porta da varanda não fecha direito' : 'Detalhes deste registro…'}
          />
        </Field>

        <div className="manut-anexos">
          <span className="manut-anexos-label">{modoMorador || tipo === 'problema' ? 'Fotos' : 'Anexos'}</span>
          <label className="manut-anexos-drop">
            <input
              type="file"
              multiple
              accept="image/*,.pdf"
              onChange={(e) => {
                setFiles([...files, ...(e.target.files || [])]);
                e.target.value = '';
              }}
            />
            <Icon name="paperclip" size={18} />
            <span>Toque para anexar fotos ou documentos</span>
          </label>
          {files.length ? (
            <ul className="manut-anexos-lista">
              {files.map((file, i) => (
                <li key={`${file.name}-${i}`}>
                  <Icon name={String(file.type).startsWith('image/') ? 'eye' : 'file'} size={15} />
                  <span className="manut-anexos-nome">{file.name}</span>
                  <small>{formatarTamanho(file.size)}</small>
                  <button type="button" aria-label={`Remover ${file.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Linha do tempo de uma unidade ---------- */

function LinhaTempoUnidade({ unidadeId, voltarPara, seletor }) {
  const { condoId, session, cargoTipo, isGestaoTecnica, isConstrutoraOrg } = useSession();
  const ehMorador = String(cargoTipo || '').toLowerCase() === 'morador';
  const ehConstrutora = isConstrutoraOrg || ehCargoConstrutora(cargoTipo);
  const tipos = tiposPermitidos({ isGestaoTecnica, ehConstrutora, ehMorador });
  const [unidade, setUnidade] = useState(null);
  const [registros, setRegistros] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);

  async function load() {
    if (!unidadeId) return;
    try {
      const [u, linha] = await Promise.all([carregarUnidade(unidadeId), carregarLinhaTempo(unidadeId)]);
      setUnidade(u);
      setRegistros(linha);
      setError('');
    } catch (err) {
      setError(mensagemErroRecebimento(err));
    } finally {
      setCarregado(true);
    }
  }

  useEffect(() => { setCarregado(false); load(); }, [unidadeId]);

  const status = statusDaUnidade(registros);
  const problemasAbertos = registros.filter((r) => r.tipo === 'problema' && !r.resolvido).length;
  const agendada = [...registros].reverse().find((r) => r.tipo === 'vistoria_agendada');
  const entregue = registros.find((r) => r.tipo === 'assinatura_entrega');
  const condominioId = unidade?.condominio_id || condoId;

  async function salvarRegistro(dados) {
    setBusy(true);
    setError('');
    try {
      await criarRegistro({ condominioId, unidadeId, userId: session.user.id, ...dados });
      setModal(false);
      await load();
    } catch (err) {
      setError(mensagemErroRecebimento(err));
      setModal(false);
    } finally {
      setBusy(false);
    }
  }

  async function enviarMensagem(registro, { texto, files }) {
    setBusy(true);
    setError('');
    try {
      await enviarMensagemRecebimento({ registroId: registro.id, condominioId, userId: session.user.id, texto, files });
      await load();
      return true;
    } catch (err) {
      setError(mensagemErroRecebimento(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function resolver(registro, resolvido) {
    setBusy(true);
    setError('');
    try {
      await marcarProblemaResolvido(registro.id, resolvido);
      await load();
    } catch (err) {
      setError(mensagemErroRecebimento(err));
    } finally {
      setBusy(false);
    }
  }

  const botaoPrincipal = tipos.length ? (
    <Btn icon={ehMorador ? 'message' : 'plus'} onClick={() => setModal(true)} disabled={busy}>
      {ehMorador ? 'Solicitar vistoria' : 'Novo registro'}
    </Btn>
  ) : null;

  return (
    <Page
      title="Recebimento"
      lead={ehMorador
        ? 'Linha do tempo da vistoria de entrega do seu imóvel.'
        : `Vistoria de entrega${unidade ? ` · ${unidade.rotulo}` : ''}`}
      actions={(
        <div className="row trace-actions">
          {botaoPrincipal}
          {voltarPara ? <Btn variant="ghost" icon="layers" to={voltarPara}>Unidades</Btn> : null}
        </div>
      )}
    >
      <Alert error={error} />
      {seletor}

      <section className="trace-summary panel">
        <div className="trace-summary-grid">
          <div>
            <span className="label">Unidade</span>
            <strong>{unidade?.rotulo || '—'}</strong>
          </div>
          <div>
            <span className="label">Situação</span>
            <StatusEntrega status={status} />
          </div>
          <div>
            <span className="label">Vistoria de entrega</span>
            <strong>{agendada ? formatDateTime(agendada.data_evento) : 'Não agendada'}</strong>
          </div>
          <div>
            <span className="label">{entregue ? 'Entrega assinada' : 'Problemas em aberto'}</span>
            <strong>{entregue ? formatDateTime(entregue.data_evento) : problemasAbertos}</strong>
          </div>
        </div>
      </section>

      {carregado && !registros.length ? (
        <Empty text={ehMorador
          ? 'Ainda não há registros da vistoria de entrega do seu imóvel.'
          : 'Nenhum registro ainda. Comece agendando a vistoria de entrega.'}
        />
      ) : (
        <ol className="trace-timeline">
          {registros.map((registro, index) => (
            <li key={registro.id} className="trace-timeline-item">
              <span className={`trace-timeline-dot rec-dot--${registro.tipo}`} aria-hidden="true" />
              {index < registros.length - 1 ? <span className="trace-timeline-line" aria-hidden="true" /> : null}
              <CartaoRegistro
                registro={registro}
                podeConversar={isGestaoTecnica || ehConstrutora}
                podeResolver={isGestaoTecnica}
                busy={busy}
                sessionUserId={session?.user?.id}
                onEnviarMensagem={enviarMensagem}
                onResolver={resolver}
              />
            </li>
          ))}
        </ol>
      )}

      {tipos.length ? (
        <div className="trace-create-bar">
          {botaoPrincipal}
          <p className="hint">
            {ehMorador
              ? 'Encontrou algo no imóvel? Solicite uma vistoria da Gestão Técnica com descrição e fotos.'
              : ehConstrutora
                ? 'Registre andamentos com título, descrição e anexos. Responda os problemas na conversa de cada um.'
                : 'Agende a vistoria, registre cada problema (abre conversa com a construtora), a vistoria realizada e, ao final, a assinatura de entrega.'}
          </p>
        </div>
      ) : null}

      <NovoRegistroModal
        open={modal}
        tipos={tipos}
        modoMorador={ehMorador}
        problemasAbertos={problemasAbertos}
        temVistoriaAgendada={Boolean(agendada)}
        onClose={() => setModal(false)}
        onSalvar={salvarRegistro}
        busy={busy}
      />
    </Page>
  );
}

/* ---------- Lista de unidades (Gestão Técnica, construtora, administração) ---------- */

function ListaUnidades() {
  const { condoId } = useSession();
  const [unidades, setUnidades] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    if (!condoId) return;
    listarUnidadesRecebimento(condoId)
      .then((lista) => { setUnidades(lista); setError(''); })
      .catch((err) => setError(mensagemErroRecebimento(err)))
      .finally(() => setCarregado(true));
  }, [condoId]);

  const contagem = useMemo(() => {
    const c = {};
    for (const u of unidades) c[u.status] = (c[u.status] || 0) + 1;
    return c;
  }, [unidades]);

  const visiveis = unidades.filter((u) => (!filtro || u.status === filtro)
    && u.rotulo.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Page title="Recebimento" lead="Vistoria de entrega de cada unidade. Escolha a unidade para ver ou registrar na linha do tempo.">
      <Alert error={error} />
      <div className="row chamado-filters">
        <label className="search-field">
          <Icon name="search" size={16} />
          <input placeholder="Pesquisar unidade" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="">Todas as situações ({unidades.length})</option>
          {Object.entries(STATUS_UNIDADE).map(([id, info]) => (
            <option key={id} value={id}>{info.label} ({contagem[id] || 0})</option>
          ))}
        </select>
      </div>
      {carregado && !visiveis.length ? (
        <Empty text={unidades.length ? 'Nenhuma unidade encontrada.' : 'Nenhuma unidade cadastrada neste condomínio.'} />
      ) : (
        <div className="ticket-list">
          {visiveis.map((u) => (
            <Link key={u.id} className="ticket-card rec-unidade" to={`/recebimento/${u.id}`}>
              <div className="ticket-card-top">
                <strong className="ticket-card-title">{u.rotulo}</strong>
                <StatusEntrega status={u.status} />
              </div>
              <small>
                {u.totalRegistros ? `${u.totalRegistros} registro(s)` : 'Sem registros'}
                {u.problemasAbertos ? ` · ${u.problemasAbertos} problema(s) em aberto` : ''}
                {u.ultimoEvento ? ` · último em ${formatDate(u.ultimoEvento)}` : ''}
              </small>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

/* ---------- Morador: o próprio imóvel ---------- */

function RecebimentoMorador({ unidadeId }) {
  const { condoId, session } = useSession();
  const navigate = useNavigate();
  const [unidades, setUnidades] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!condoId || !session?.user?.id) return;
    unidadesDoMorador(condoId, session.user.id)
      .then((lista) => { setUnidades(lista); setError(''); })
      .catch((err) => setError(mensagemErroRecebimento(err)))
      .finally(() => setCarregado(true));
  }, [condoId, session?.user?.id]);

  if (!carregado) return <Page title="Recebimento"><p className="hint">Carregando…</p></Page>;
  if (!unidades.length) {
    return (
      <Page title="Recebimento">
        <Alert error={error} />
        <Empty text="Seu usuário ainda não está vinculado a uma unidade. Fale com a administração do condomínio." />
      </Page>
    );
  }
  const atual = unidades.find((u) => u.id === unidadeId) || unidades[0];
  const seletor = unidades.length > 1 ? (
    <div className="rec-unidades-tabs" role="tablist" aria-label="Seus imóveis">
      {unidades.map((u) => (
        <button
          key={u.id}
          type="button"
          role="tab"
          aria-selected={u.id === atual.id}
          className={u.id === atual.id ? 'is-on' : ''}
          onClick={() => navigate(`/recebimento/${u.id}`)}
        >
          {u.rotulo}
        </button>
      ))}
    </div>
  ) : null;
  return <LinhaTempoUnidade unidadeId={atual.id} seletor={seletor} />;
}

export function RecebimentoPage() {
  const { unidadeId } = useParams();
  const { cargoTipo } = useSession();
  const ehMorador = String(cargoTipo || '').toLowerCase() === 'morador';
  if (ehMorador) return <RecebimentoMorador unidadeId={unidadeId} />;
  if (unidadeId) return <LinhaTempoUnidade unidadeId={unidadeId} voltarPara="/recebimento" />;
  return <ListaUnidades />;
}
