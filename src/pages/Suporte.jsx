import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { STATUS_CHAMADO, STATUS_LABEL, ehChamadoAdministracao } from '../lib/permissions';
import { chamadoNumero, formatDateTime, formatTelefone, labelUnidade, nomePessoa, nomeSolicitanteChamado, rotuloSolicitanteUnidade } from '../lib/format';
import { enviarMensagemChamado, garantirChatChamado, anexarArquivosNasMensagens, enviarArquivoChamado, juntarMensagensComAbertura, hidratarNomesChamados, hidratarNomesMensagens, mapNomesUsuarios, mapaUltimasMensagensChamados, carregarEventosChatChamado } from '../lib/api';
import {
  classeListaConversa,
  mapaLeituraConversas,
  marcarConversaLidaPorChamado,
} from '../lib/notifications';
import { Alert, Badge, Btn, ChamadoAdminBanner, ChamadoAdminTag, Empty } from '../components/ui';
import { Icon } from '../components/icons';
import { GestaoBar } from '../components/GestaoBar';
import { ChatComposer, ChatHeader, ChatLog } from '../components/Chat';
import { StatusPicker } from '../components/StatusPicker';
import { UnreadOrb } from '../components/UnreadOrb';
import { Modal } from '../components/DataList';
import { AgendarVisitaModal } from './AgendarVisita';

export function SuportePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isGestaoTecnica, memberships, session, selectCondo } = useSession();
  const [rows, setRows] = useState([]);
  const [condoFiltro, setCondoFiltro] = useState(() => searchParams.get('condo') || '');
  const [soNaoLidas, setSoNaoLidas] = useState(() => searchParams.get('naoLidas') === '1');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [chamado, setChamado] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const [leitura, setLeitura] = useState({});
  const [lidaAte, setLidaAte] = useState(null);
  const [perfilOpen, setPerfilOpen] = useState(false);
  const [perfil, setPerfil] = useState(null);
  const [ocorrencias, setOcorrencias] = useState([]);
  const [perfilBusy, setPerfilBusy] = useState(false);
  const [visitaModal, setVisitaModal] = useState(false);
  const [historico, setHistorico] = useState([]);
  const [visitas, setVisitas] = useState([]);
  const [previews, setPreviews] = useState({});
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
      .select('*, usuarios:solicitante_id(nome), unidades(identificacao, bloco, andar), condominios(id, nome)')
      .order('updated_at', { ascending: false });
    if (err) {
      const plain = await supabase
        .from('chamados')
        .select('*, usuarios:solicitante_id(nome), unidades(identificacao, bloco, andar)')
        .order('updated_at', { ascending: false });
      data = plain.data;
      err = plain.error;
    }
    if (err) setError(err.message);
    const hydrated = await hidratarNomesChamados(data || []);
    setRows(hydrated);
    try {
      const [map, last] = await Promise.all([
        mapaLeituraConversas(),
        mapaUltimasMensagensChamados(hydrated.map((row) => row.id)),
      ]);
      setLeitura(map.byChamado || {});
      setPreviews(last || {});
    } catch {
      setLeitura({});
    }
  }

  async function loadChat(chamadoId) {
    if (!chamadoId) {
      setChamado(null);
      setMensagens([]);
      setHistorico([]);
      setVisitas([]);
      setLidaAte(null);
      return;
    }
    const { data, error: err } = await supabase
      .from('chamados')
      .select('*, usuarios:solicitante_id(id, nome, email, telefone), unidades(identificacao, bloco, andar), condominios(id, nome)')
      .eq('id', chamadoId)
      .single();
    if (err) {
      setError(err.message);
      setChamado(null);
      setMensagens([]);
      setHistorico([]);
      setVisitas([]);
      return;
    }
    const [ticket] = await hidratarNomesChamados([data]);
    setChamado(ticket);
    const eventos = await carregarEventosChatChamado(chamadoId);
    setHistorico(eventos.historico);
    setVisitas(eventos.visitas);
    try {
      const convId = await garantirChatChamado(chamadoId, session.user.id);
      const part = await supabase
        .from('conversa_participantes')
        .select('ultima_leitura_em')
        .eq('conversa_id', convId)
        .eq('usuario_id', session.user.id)
        .maybeSingle();
      const ate = part.data?.ultima_leitura_em || null;
      setLidaAte(ate);
      const msgs = await supabase
        .from('mensagens')
        .select('*, usuarios:usuario_id(nome)')
        .eq('conversa_id', convId)
        .order('created_at');
      const joined = await juntarMensagensComAbertura(ticket, await anexarArquivosNasMensagens(msgs.data || []));
      const named = await hidratarNomesMensagens(joined, {
        solicitanteId: ticket.solicitante_id,
        solicitanteNome: ticket.usuarios?.nome,
        condominioId: ticket.condominio_id,
      });
      if (named.nomes[ticket.solicitante_id]) {
        setChamado({
          ...ticket,
          usuarios: { ...(ticket.usuarios || {}), nome: named.nomes[ticket.solicitante_id] },
        });
      }
      setMensagens(named.mensagens);
      await marcarConversaLidaPorChamado(chamadoId);
      const map = await mapaLeituraConversas();
      setLeitura(map.byChamado || {});
    } catch (chatErr) {
      const conv = await supabase.from('conversas').select('id').eq('chamado_id', chamadoId).maybeSingle();
      if (conv.data?.id) {
        const msgs = await supabase
          .from('mensagens')
          .select('*, usuarios:usuario_id(nome)')
          .eq('conversa_id', conv.data.id)
          .order('created_at');
        const joined = await juntarMensagensComAbertura(ticket, await anexarArquivosNasMensagens(msgs.data || []));
        const named = await hidratarNomesMensagens(joined, {
          solicitanteId: ticket.solicitante_id,
          solicitanteNome: ticket.usuarios?.nome,
          condominioId: ticket.condominio_id,
        });
        setMensagens(named.mensagens);
        await marcarConversaLidaPorChamado(chamadoId);
      } else {
        setMensagens([]);
        setError(chatErr.message || '');
      }
    }
  }

  useEffect(() => {
    const condo = searchParams.get('condo') || '';
    const nao = searchParams.get('naoLidas') === '1';
    if (condo) setCondoFiltro(condo);
    if (nao) setSoNaoLidas(true);
  }, [searchParams]);

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
  }, [mensagens, historico, visitas]);

  const filtrados = rows.filter((row) => {
    const text = `${row.titulo} ${row.numero_registro} ${nomePessoa(row.usuarios)} ${row.condominios?.nome || ''} ${labelUnidade(row.unidades)} ${previews[row.id] || ''}`.toLowerCase();
    const estado = leitura[row.id]?.estado || 'lida';
    const unreadOk = !soNaoLidas || estado === 'nova' || estado === 'nao_lida';
    return (!condoFiltro || row.condominio_id === condoFiltro)
      && (!status || row.status === status)
      && unreadOk
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

  async function abrirPerfilSolicitante() {
    if (!chamado?.solicitante_id) return;
    setPerfilBusy(true);
    setPerfilOpen(true);
    try {
      const userId = chamado.solicitante_id;
      const condoId = chamado.condominio_id;

      let user = chamado.usuarios || null;
      const nomes = await mapNomesUsuarios([userId], condoId);
      const { data } = await supabase
        .from('usuarios')
        .select('id, nome, email, telefone, ativo')
        .eq('id', userId)
        .maybeSingle();
      if (data) {
        user = {
          ...user,
          ...data,
          nome: nomes[userId] || data.nome || user?.nome,
          email: data.email || user?.email,
          telefone: data.telefone || user?.telefone,
        };
      } else if (nomes[userId]) {
        user = { ...user, nome: nomes[userId] };
      }
      if (!user?.nome && chamado.usuarios?.nome) {
        user = { ...user, nome: chamado.usuarios.nome };
      }

      let unidade = labelUnidade(chamado.unidades);
      if (!unidade) {
        const { data: moradias } = await supabase
          .from('unidade_moradores')
          .select('unidades(identificacao, bloco, andar, condominio_id)')
          .eq('usuario_id', userId);
        unidade = (moradias || [])
          .filter((row) => !condoId || row.unidades?.condominio_id === condoId)
          .map((row) => labelUnidade(row.unidades))
          .filter(Boolean)
          .join(' · ');
      }

      const { data: hist } = await supabase
        .from('chamados')
        .select('id, numero_registro, titulo, status, created_at, updated_at, unidades(identificacao, bloco, andar)')
        .eq('solicitante_id', userId)
        .eq('condominio_id', condoId)
        .order('created_at', { ascending: false })
        .limit(20);

      setPerfil({
        ...user,
        unidade: unidade || '—',
        condominio: chamado.condominios?.nome || '—',
      });
      setOcorrencias(hist || []);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar o perfil.');
      setPerfil(null);
      setOcorrencias([]);
    } finally {
      setPerfilBusy(false);
    }
  }

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
          <label className="prefs-inline-check">
            <input
              type="checkbox"
              checked={soNaoLidas}
              onChange={(e) => setSoNaoLidas(e.target.checked)}
            />
            Só não lidas
          </label>
        </div>

        <div className={`suporte-layout suporte-layout--mobile-nav${id ? ' suporte-layout--open' : ''}`}>
          <aside className="panel suporte-list">
            {!grupos.length ? <Empty text="Nenhum suporte encontrado." /> : grupos.map((grupo) => (
              <section className="suporte-group" key={grupo.id}>
                {!condoFiltro ? <h3>{grupo.nome}</h3> : null}
                {grupo.items.map((row) => {
                  const estado = leitura[row.id]?.estado || 'lida';
                  const unread = estado === 'nova' || estado === 'nao_lida';
                  const daAdmin = ehChamadoAdministracao(row);
                  return (
                  <button
                    type="button"
                    key={row.id}
                    className={`suporte-item${daAdmin ? ' suporte-item--admin' : ''}${row.id === id ? ' active' : ''} ${classeListaConversa(estado)}`.trim()}
                    onClick={() => navigate(`/suporte/${row.id}`)}
                  >
                    {unread ? (
                      <UnreadOrb
                        count={leitura[row.id]?.nao_lidas || 1}
                        variant={estado === 'nova' ? 'nova' : 'alerta'}
                        title={estado === 'nova' ? 'Conversa nova — abrir' : 'Mensagens novas — abrir'}
                        onClick={() => navigate(`/suporte/${row.id}`)}
                      />
                    ) : null}
                    <div className="suporte-item-top">
                      <strong className="suporte-item-name">
                        {rotuloSolicitanteUnidade(row, { administracao: daAdmin })}
                      </strong>
                      <span className="ticket-card-tags">
                        {daAdmin ? <ChamadoAdminTag compact /> : null}
                        <Badge value={row.status} />
                      </span>
                    </div>
                    <small className="suporte-item-preview">
                      {previews[row.id] || 'Sem mensagens'}
                    </small>
                  </button>
                  );
                })}
              </section>
            ))}
          </aside>

          <section className={`chat-shell suporte-chat${chamado ? '' : ' empty'}`}>
            {!chamado ? (
              <Empty text="Selecione um chamado para ver o chat." />
            ) : (
              <>
                <div className="chat-top">
                  <button
                    type="button"
                    className="suporte-back"
                    onClick={() => navigate('/suporte')}
                  >
                    <Icon name="chevron" size={18} />
                    Conversas
                  </button>
                  <ChatHeader
                    title={chamado.titulo}
                    subtitle={[
                      ehChamadoAdministracao(chamado) ? null : nomeSolicitanteChamado(chamado),
                      labelUnidade(chamado.unidades),
                    ].filter(Boolean).join(' · ') || undefined}
                    onClick={abrirPerfilSolicitante}
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
                      icon="calendar"
                      onClick={() => setVisitaModal(true)}
                    >
                      Agendar visita
                    </Btn>
                    <Btn
                      variant="ghost"
                      icon="layers"
                      onClick={() => {
                        selectCondo(chamado.condominio_id);
                        navigate(`/rastreabilidade/${chamado.id}`);
                      }}
                    >
                      Rastreabilidade
                    </Btn>
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
                  {ehChamadoAdministracao(chamado) ? <ChamadoAdminBanner /> : null}
                </div>
                <div className="chat-log" ref={chatLogRef}>
                  <ChatLog
                    mensagens={mensagens}
                    historico={historico}
                    visitas={visitas}
                    sessionUserId={session.user.id}
                    lidaAte={lidaAte}
                    solicitanteId={chamado.solicitante_id}
                    solicitanteNome={nomePessoa(chamado.usuarios)}
                    origemAdmin={ehChamadoAdministracao(chamado)}
                    empty="Nenhuma mensagem ainda."
                  />
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

      <AgendarVisitaModal
        open={visitaModal}
        onClose={() => setVisitaModal(false)}
        chamadoId={chamado?.id}
        condominioId={chamado?.condominio_id}
        onScheduled={() => chamado?.id ? loadChat(chamado.id) : undefined}
      />

      <Modal
        open={perfilOpen}
        title={perfil?.nome || 'Solicitante'}
        onClose={() => setPerfilOpen(false)}
        className="modal-sheet--wide suporte-perfil-modal"
      >
        {perfilBusy && !perfil ? (
          <p className="suporte-perfil-loading">Carregando…</p>
        ) : (
          <div className="suporte-perfil">
            <dl className="suporte-perfil-fields">
              {[
                { label: 'Nome', value: perfil?.nome },
                { label: 'Origem', value: ehChamadoAdministracao(chamado) ? 'Administração do condomínio' : 'Morador' },
                { label: 'E-mail', value: perfil?.email },
                { label: 'Telefone', value: perfil?.telefone ? (formatTelefone(perfil.telefone) || perfil.telefone) : perfil?.telefone },
                { label: 'Unidade', value: perfil?.unidade },
                { label: 'Condomínio', value: perfil?.condominio },
              ].map((item) => (
                <div key={item.label} className="suporte-perfil-field">
                  <dt>{item.label}</dt>
                  <dd>{item.value == null || item.value === '' ? '—' : item.value}</dd>
                </div>
              ))}
            </dl>

            <section className="suporte-perfil-ocorrencias">
              <header className="suporte-perfil-ocorrencias-head">
                <h3>Ocorrências</h3>
                <span>{ocorrencias.length} registro(s)</span>
              </header>
              {!ocorrencias.length ? (
                <Empty text="Nenhuma ocorrência encontrada." />
              ) : (
                <ul className="suporte-ocorrencia-lista">
                  {ocorrencias.map((row) => {
                    const atual = row.id === chamado?.id;
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={`suporte-ocorrencia${atual ? ' is-atual' : ''}`}
                          onClick={() => {
                            setPerfilOpen(false);
                            navigate(`/suporte/${row.id}`);
                          }}
                        >
                          <div className="suporte-ocorrencia-top">
                            <strong className="suporte-ocorrencia-titulo">{row.titulo || 'Sem título'}</strong>
                            <span className="suporte-ocorrencia-badges">
                              <Badge value={row.status} />
                              {atual ? <span className="suporte-ocorrencia-atual">Atual</span> : null}
                            </span>
                          </div>
                          <div className="suporte-ocorrencia-meta">
                            <span>{chamadoNumero(row.numero_registro)}</span>
                            {labelUnidade(row.unidades) ? <span>{labelUnidade(row.unidades)}</span> : null}
                            {row.created_at ? <span>{formatDateTime(row.created_at)}</span> : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </Modal>
    </div>
  );
}
