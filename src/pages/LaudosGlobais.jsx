import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { chamadoNumero, rotuloLaudoUnidade } from '../lib/format';
import {
  anexarArquivosNasMensagens,
  carregarLaudoGovernanca,
  enviarArquivoLaudo,
  enviarMensagemLaudo,
  garantirChatLaudo,
  hidratarNomesMensagens,
  juntarMensagensComAberturaLaudo,
  hidratarFotosMensagens,
  listarLaudosGlobais,
} from '../lib/api';
import {
  classeListaConversa,
  mapaLeituraConversas,
  marcarConversaLidaPorLaudo,
} from '../lib/notifications';
import { Alert, Btn, Empty } from '../components/ui';
import { Icon } from '../components/icons';
import { GestaoBar } from '../components/GestaoBar';
import { ChatComposer, ChatHeader, CriticidadeTag, LaudoThread, LaudoThumb } from '../components/Chat';
import { UnreadOrb } from '../components/UnreadOrb';

export function LaudosGlobaisPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isGestaoTecnica, isConstrutoraOrg, memberships, session, selectCondo } = useSession();
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
    try {
      const data = await listarLaudosGlobais();
      setRows(data);
      setError('');
      const map = await mapaLeituraConversas();
      setLeitura(map.byLaudo || {});
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
      if (!data.condominios && data.condominio_id) {
        data.condominios = condos.find((c) => c.id === data.condominio_id) || null;
      }
      setLaudo(data);
      setError('');
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
        .select('*, usuarios:usuario_id(nome)')
        .eq('conversa_id', convId)
        .order('created_at');
      const withFiles = await anexarArquivosNasMensagens(msgs.data || []);
      const joined = await juntarMensagensComAberturaLaudo(data, withFiles);
      const named = await hidratarNomesMensagens(joined, {
        condominioId: data.condominio_id,
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

  const podeVerGlobais = isGestaoTecnica || isConstrutoraOrg;

  useEffect(() => {
    if (!podeVerGlobais) return;
    loadLista();
  }, [podeVerGlobais]);

  useEffect(() => {
    if (!podeVerGlobais) return;
    loadChat(id);
  }, [id, podeVerGlobais, session?.user?.id]);

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

  const filtrados = rows.filter((row) => {
    const text = `${rotuloLaudoUnidade(row)} ${row.chamado_numero || row.chamados?.numero_registro || ''} ${row.condominios?.nome || ''} ${row.criticidade || ''}`.toLowerCase();
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

  if (!podeVerGlobais) {
    return (
      <div className="portal">
        <Alert error="Somente a Gestão Técnica e a construtora acessam os laudos globais." />
      </div>
    );
  }

  return (
    <div className="portal">
      <GestaoBar variant={isConstrutoraOrg ? 'construtora' : 'gestao'} />
      <main className="portal-main wide">
        <div className="page-head">
          <h1>{isConstrutoraOrg ? 'Governança técnica' : 'Laudo técnico'}</h1>
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
            <input placeholder="Pesquisar unidade, chamado ou condomínio" value={q} onChange={(e) => setQ(e.target.value)} />
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
                      className={`suporte-item laudo-item${row.id === id ? ' active' : ''} ${classeListaConversa(estado)}`.trim()}
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
              </section>
            ))}
          </aside>

          <section className={`chat-shell laudo-shell suporte-chat${laudo ? '' : ' empty'}`}>
            {!laudo ? (
              <Empty text="Selecione um laudo para acompanhar." />
            ) : (
              <>
                <ChatHeader
                  icon="clipboard"
                  title={rotuloLaudoUnidade(laudo)}
                  subtitle={`${chamadoNumero(laudo.chamados?.numero_registro ?? laudo.chamado_numero)}${laudo.condominios?.nome ? ` · ${laudo.condominios.nome}` : ''}`}
                >
                  <CriticidadeTag value={laudo.criticidade} />
                  <Btn
                    variant="ghost"
                    icon="building"
                    onClick={() => {
                      selectCondo(laudo.condominio_id);
                      navigate(isConstrutoraOrg
                        ? `/construtora/${laudo.condominio_id}/governanca/${laudo.id}`
                        : `/governanca-tecnica/${laudo.id}`);
                    }}
                  >
                    Abrir no condomínio
                  </Btn>
                </ChatHeader>
                <div className="chat-log laudo-log" ref={chatLogRef}>
                  <LaudoThread
                    mensagens={mensagens}
                    sessionUserId={session.user.id}
                    lidaAte={lidaAte}
                    empty="Nenhuma nota ainda."
                  />
                </div>
                <ChatComposer
                  value={texto}
                  onChange={setTexto}
                  sending={sending}
                  onSend={send}
                  onFile={sendFile}
                  placeholder="Escreva uma nota para a Construtora"
                />
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
