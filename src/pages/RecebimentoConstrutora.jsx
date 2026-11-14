import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { formatDateTime } from '../lib/format';
import {
  PAPEL_LABEL,
  carregarLinhaTempo,
  enviarMensagemRecebimento,
  listarChatsRecebimento,
  mensagemErroRecebimento,
} from '../lib/recebimento';
import { Alert, Btn, Empty } from '../components/ui';
import { Icon } from '../components/icons';
import { GestaoBar } from '../components/GestaoBar';
import { ChatHeader } from '../components/Chat';
import { ComposerProblema, GaleriaRecebimento, MensagensProblema } from './Recebimento';

/** Construtora: todas as conversas de problemas da vistoria de entrega, de todos os condomínios. */
export function RecebimentoConstrutoraPage() {
  const { registroId } = useParams();
  const navigate = useNavigate();
  const { isConstrutoraOrg, isGestaoTecnica, session, selectCondo } = useSession();
  const [chats, setChats] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [condoFiltro, setCondoFiltro] = useState('');
  const [situacao, setSituacao] = useState('abertos');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [registro, setRegistro] = useState(null);
  const [busy, setBusy] = useState(false);

  async function loadLista() {
    try {
      setChats(await listarChatsRecebimento());
      setError('');
    } catch (err) {
      setError(mensagemErroRecebimento(err));
    } finally {
      setCarregado(true);
    }
  }

  async function loadChat(id) {
    if (!id) {
      setRegistro(null);
      return;
    }
    const resumo = chats.find((c) => c.id === id);
    if (!resumo) return;
    try {
      const linha = await carregarLinhaTempo(resumo.unidade_id);
      setRegistro({ ...(linha.find((r) => r.id === id) || {}), resumo });
    } catch (err) {
      setError(mensagemErroRecebimento(err));
    }
  }

  useEffect(() => { loadLista(); }, []);
  useEffect(() => { loadChat(registroId); }, [registroId, chats]);

  const condos = useMemo(() => {
    const mapa = new Map();
    for (const c of chats) if (c.condominio?.id) mapa.set(c.condominio.id, c.condominio.nome || 'Condomínio');
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [chats]);

  const filtrados = chats.filter((c) => {
    if (condoFiltro && c.condominio_id !== condoFiltro) return false;
    if (situacao === 'abertos' && c.resolvido) return false;
    if (situacao === 'resolvidos' && !c.resolvido) return false;
    const texto = `${c.titulo || ''} ${c.rotuloUnidade} ${c.condominio?.nome || ''}`.toLowerCase();
    return texto.includes(q.trim().toLowerCase());
  });

  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const c of filtrados) {
      const key = c.condominio_id || 'sem';
      if (!mapa.has(key)) mapa.set(key, { id: key, nome: c.condominio?.nome || 'Condomínio', items: [] });
      mapa.get(key).items.push(c);
    }
    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [filtrados]);

  async function enviar({ texto, files }) {
    if (!registro?.id) return false;
    setBusy(true);
    setError('');
    try {
      await enviarMensagemRecebimento({
        registroId: registro.id,
        condominioId: registro.condominio_id,
        userId: session.user.id,
        texto,
        files,
      });
      await loadLista();
      return true;
    } catch (err) {
      setError(mensagemErroRecebimento(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!isConstrutoraOrg && !isGestaoTecnica) {
    return (
      <div className="portal">
        <Alert error="Somente a construtora acessa esta tela." />
      </div>
    );
  }

  return (
    <div className="portal">
      <GestaoBar variant={isConstrutoraOrg ? 'construtora' : 'gestao'} />
      <main className="portal-main wide">
        <div className="page-head">
          <h1>Recebimento</h1>
          <p>Problemas encontrados pela Gestão Técnica nas vistorias de entrega. Cada problema é uma conversa.</p>
        </div>
        <Alert error={error} />
        <div className="row" style={{ marginBottom: 16 }}>
          <select value={condoFiltro} onChange={(e) => setCondoFiltro(e.target.value)}>
            <option value="">Todos os condomínios</option>
            {condos.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
          <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            <option value="abertos">Em aberto</option>
            <option value="resolvidos">Resolvidos</option>
            <option value="">Todos</option>
          </select>
          <label className="search-field">
            <Icon name="search" size={16} />
            <input placeholder="Pesquisar problema, unidade ou condomínio" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        <div className="suporte-layout">
          <aside className="panel suporte-list">
            {carregado && !grupos.length ? <Empty text="Nenhum problema de recebimento." /> : grupos.map((grupo) => (
              <section className="suporte-group" key={grupo.id}>
                {!condoFiltro ? <h3>{grupo.nome}</h3> : null}
                {grupo.items.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className={`suporte-item rec-chat-item${c.id === registroId ? ' active' : ''}`}
                    onClick={() => navigate(`/construtora-recebimento/${c.id}`)}
                  >
                    <span className={`rec-chat-item-dot${c.resolvido ? ' is-ok' : ''}`} aria-hidden="true" />
                    <span className="rec-chat-item-copy">
                      <strong className="suporte-item-name">{c.titulo || 'Problema'}</strong>
                      <small className="suporte-item-preview">
                        {c.rotuloUnidade}
                        {c.ultimaMensagem
                          ? ` · ${PAPEL_LABEL[c.ultimaMensagem.autor_papel] || 'Mensagem'}: ${c.ultimaMensagem.texto}`
                          : ' · Sem mensagens'}
                      </small>
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </aside>

          <section className={`chat-shell suporte-chat rec-chat-painel${registro?.id ? '' : ' empty'}`}>
            {!registro?.id ? (
              <Empty text="Selecione um problema para conversar." />
            ) : (
              <>
                <ChatHeader
                  icon="alert"
                  title={registro.titulo || 'Problema'}
                  subtitle={`${registro.resumo.rotuloUnidade} · ${registro.resumo.condominio?.nome || ''} · ${registro.resolvido ? 'Resolvido' : 'Em aberto'}`}
                >
                  <Btn
                    variant="ghost"
                    icon="layers"
                    onClick={() => {
                      selectCondo(registro.condominio_id);
                      navigate(`/recebimento/${registro.unidade_id}`);
                    }}
                  >
                    Linha do tempo
                  </Btn>
                </ChatHeader>
                <div className="chat-log rec-chat-log">
                  <article className="rec-chat-abertura">
                    <header>
                      <strong>Problema registrado</strong>
                      <time>{formatDateTime(registro.data_evento)}</time>
                    </header>
                    {registro.descricao ? <p>{registro.descricao}</p> : null}
                    <GaleriaRecebimento arquivos={registro.arquivos} />
                  </article>
                  <MensagensProblema mensagens={registro.mensagens} sessionUserId={session?.user?.id} />
                </div>
                <ComposerProblema busy={busy} placeholder="Escreva para a Gestão Técnica" onEnviar={enviar} />
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
