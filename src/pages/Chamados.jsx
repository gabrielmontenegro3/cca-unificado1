import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can, ehCargoAdministracao, ehCargoConstrutora, ehChamadoAdministracao, STATUS_CHAMADO, STATUS_LABEL, UNIDADE_AREAS_COMUNS } from '../lib/permissions';
import { chamadoNumero, formatDateTime, labelUnidade, nomePessoa, nomeSolicitanteChamado } from '../lib/format';
import { criarChamado, minhaUnidade, enviarMensagemChamado, garantirChatChamado, anexarArquivosNasMensagens, enviarArquivoChamado, avaliarChamado, juntarMensagensComAbertura, hidratarNomesChamados, hidratarNomesMensagens, listarAgendamentosVisitaChamado } from '../lib/api';
import { ocorrenciaConcluida } from '../lib/ocorrenciasRelatorio';
import { classeListaConversa, mapaLeituraConversas, marcarConversaLidaPorChamado } from '../lib/notifications';
import { Alert, Badge, Btn, ChamadoAdminBanner, ChamadoAdminTag, Empty, Field, Page } from '../components/ui';
import { Icon } from '../components/icons';
import { ChatComposer, ChatHeader, ChatLog } from '../components/Chat';
import { StatusPicker } from '../components/StatusPicker';
import { UnreadOrb } from '../components/UnreadOrb';
import { AgendarVisitaModal } from './AgendarVisita';
import { SatisfacaoChamado, notaSatisfacao } from '../components/SatisfacaoEstrelas';
import { CriarLaudoModal } from '../components/CriarLaudoModal';

export function ChamadosPage() {
  const { condoId, cargoTipo, session } = useSession();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [leitura, setLeitura] = useState({});
  const all = can(cargoTipo, 'view_all_tickets');

  useEffect(() => {
    if (!condoId) return;
    let query = supabase
      .from('chamados')
      .select('*, usuarios:solicitante_id(nome), unidades(identificacao, bloco, andar), locais(nome)')
      .eq('condominio_id', condoId)
      .order('created_at', { ascending: false });
    if (!all) query = query.eq('solicitante_id', session.user.id);
    query.then(async ({ data, error: err }) => {
      if (err) setError(err.message);
      setRows(await hidratarNomesChamados(data || []));
      try {
        const map = await mapaLeituraConversas();
        setLeitura(map.byChamado || {});
      } catch {
        setLeitura({});
      }
    });
  }, [condoId, all, session.user.id]);

  const filtered = rows.filter((row) => {
    const text = `${row.titulo} ${row.numero_registro} ${nomePessoa(row.usuarios)} ${labelUnidade(row.unidades)}`.toLowerCase();
    return (!status || row.status === status) && text.includes(q.toLowerCase());
  });

  return (
    <Page
      title={all ? 'Chamados' : 'Assistência técnica'}
      lead="Abra um atendimento e acompanhe a conversa com a equipe."
      actions={can(cargoTipo, 'create_ticket') ? <Btn to="/chamados/novo" icon="plus">Abrir chamado</Btn> : null}
    >
      <Alert error={error} />
      <div className="row chamado-filters">
        <label className="search-field">
          <Icon name="search" size={16} />
          <input placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_CHAMADO.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      {!filtered.length ? (
        <Empty text="Nenhum chamado encontrado." />
      ) : (
        <div className="ticket-list">
          {filtered.map((row) => {
            const estado = leitura[row.id]?.estado;
            const unread = estado === 'nova' || estado === 'nao_lida';
            const daAdmin = ehChamadoAdministracao(row);
            return (
              <Link
                className={`ticket-card${daAdmin ? ' ticket-card--admin' : ''} ${classeListaConversa(estado)}`.trim()}
                key={row.id}
                to={`/chamados/${row.id}`}
              >
                {unread ? (
                  <UnreadOrb
                    count={leitura[row.id]?.nao_lidas || 1}
                    variant={estado === 'nova' ? 'nova' : 'alerta'}
                    title={estado === 'nova' ? 'Conversa nova' : 'Mensagens novas'}
                    onClick={() => navigate(`/chamados/${row.id}`)}
                  />
                ) : null}
                <div className="ticket-card-top">
                  <strong className="ticket-card-title">{row.titulo}</strong>
                  <span className="ticket-card-tags">
                    {daAdmin ? <ChamadoAdminTag /> : null}
                    <Badge value={row.status} />
                  </span>
                </div>
                <small>
                  {labelUnidade(row.unidades, 'Unidade')}
                  {all ? ` · ${nomeSolicitanteChamado(row, { administracao: daAdmin })}` : ''}
                  {' · '}
                  {formatDateTime(row.updated_at)}
                </small>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}

export function ChamadoNovoPage() {
  const { condoId, cargoTipo, session } = useSession();
  const navigate = useNavigate();
  const [unidade, setUnidade] = useState(null);
  const [unidadePronta, setUnidadePronta] = useState(false);
  const [form, setForm] = useState({ titulo: '', descricao: '' });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const podeAbrir = can(cargoTipo, 'create_ticket');
  const ehAdminCondo = ehCargoAdministracao(cargoTipo);

  useEffect(() => {
    if (!condoId || !podeAbrir) return;
    minhaUnidade(condoId)
      .then((row) => {
        setUnidade(row);
        setUnidadePronta(true);
      })
      .catch((err) => {
        setError(err.message);
        setUnidadePronta(true);
      });
  }, [condoId, podeAbrir]);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const chamado = await criarChamado({
        condominioId: condoId,
        userId: session.user.id,
        titulo: form.titulo,
        descricao: form.descricao,
        files,
      });
      navigate(`/chamados/${chamado.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!podeAbrir) {
    if (ehCargoConstrutora(cargoTipo)) return <Navigate to="/governanca-tecnica" replace />;
    return (
      <Page title="Abrir chamado">
        <Alert error="Somente o morador ou a Administração do condomínio podem abrir chamado." />
      </Page>
    );
  }

  return (
    <Page
      title="Abrir chamado"
      lead={ehAdminCondo
        ? 'Descreva o problema nas áreas comuns. A Gestão Técnica verá que o chamado é da Administração do condomínio.'
        : 'Descreva o problema. Fotos ajudam a equipe técnica.'}
    >
      <Alert error={error} />
      <form className="panel stack" onSubmit={onSubmit}>
        <p className="hint">
          Unidade: <strong>{ehAdminCondo ? UNIDADE_AREAS_COMUNS : (unidadePronta ? (unidade?.rotulo || 'Não cadastrada') : 'Carregando…')}</strong>
        </p>
        {ehAdminCondo ? (
          <p className="hint">Este chamado fica atrelado à unidade Áreas comuns, para problemas das áreas comuns do condomínio.</p>
        ) : null}
        <Field label="Título"><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required /></Field>
        <Field label="Descrição"><textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} required /></Field>
        <Field label="Fotos ou documentos">
          <input type="file" multiple accept="image/*,.pdf" capture="environment" onChange={(e) => setFiles([...e.target.files])} />
        </Field>
        <Btn type="submit" icon="send" disabled={busy || (!ehAdminCondo && !unidade?.id)}>{busy ? 'Enviando…' : 'Registrar chamado'}</Btn>
      </form>
    </Page>
  );
}

export function ChamadoDetalhePage() {
  const { id } = useParams();
  const { condoId, cargoTipo, session } = useSession();
  const [chamado, setChamado] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [conversa, setConversa] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [laudo, setLaudo] = useState(null);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const chatLogRef = useRef(null);
  const [lidaAte, setLidaAte] = useState(null);
  const [visitas, setVisitas] = useState([]);
  const [visitaModal, setVisitaModal] = useState(false);
  const [laudoModal, setLaudoModal] = useState(false);
  const [satBusy, setSatBusy] = useState(false);
  const [satError, setSatError] = useState('');
  const canStatus = can(cargoTipo, 'change_status');
  const canLaudo = can(cargoTipo, 'create_laudo');
  const podeAgendar = can(cargoTipo, 'manage_traceability');
  const ehMorador = String(cargoTipo || '').toLowerCase() === 'morador';

  async function load() {
    const { data, error: err } = await supabase
      .from('chamados')
      .select('*, usuarios:solicitante_id(nome), unidades(identificacao, bloco, andar), locais(nome)')
      .eq('id', id)
      .single();
    if (err) return setError(err.message);
    const [ticket] = await hidratarNomesChamados([data]);
    setChamado(ticket);
    const hist = await supabase.from('chamado_status_historico').select('*, usuarios:alterado_por(nome)').eq('chamado_id', id).order('created_at');
    setHistorico(hist.data || []);
    const conv = await supabase.from('conversas').select('*').eq('chamado_id', id).maybeSingle();
    let convData = conv.data;
    if (!convData) {
      try {
        const convId = await garantirChatChamado(id, session.user.id);
        const created = await supabase.from('conversas').select('*').eq('id', convId).maybeSingle();
        convData = created.data || (convId ? { id: convId } : null);
      } catch {
        convData = null;
      }
    }
    setConversa(convData);
    if (convData?.id) {
      const part = await supabase
        .from('conversa_participantes')
        .select('ultima_leitura_em')
        .eq('conversa_id', convData.id)
        .eq('usuario_id', session.user.id)
        .maybeSingle();
      setLidaAte(part.data?.ultima_leitura_em || null);
      const msgs = await supabase.from('mensagens').select('*, usuarios:usuario_id(nome)').eq('conversa_id', convData.id).order('created_at');
      const loaded = await anexarArquivosNasMensagens(msgs.data || []);
      const joined = await juntarMensagensComAbertura(ticket, loaded);
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
      await marcarConversaLidaPorChamado(id);
      setVisitas(await listarAgendamentosVisitaChamado(id));
    } else {
      const named = await hidratarNomesMensagens(await juntarMensagensComAbertura(ticket, []), {
        solicitanteId: ticket.solicitante_id,
        solicitanteNome: ticket.usuarios?.nome,
        condominioId: ticket.condominio_id,
      });
      setMensagens(named.mensagens);
      setVisitas(await listarAgendamentosVisitaChamado(id));
    }
    const lau = await supabase.from('laudos_tecnicos').select('id, numero_registro').eq('chamado_id', id).maybeSingle();
    setLaudo(lau.data);
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return undefined;
    const go = () => { el.scrollTop = el.scrollHeight; };
    go();
    const t = setTimeout(go, 250);
    return () => clearTimeout(t);
  }, [mensagens, historico, visitas]);

  useEffect(() => {
    if (!conversa?.id) return undefined;
    const channel = supabase
      .channel(`chat-${conversa.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagens', filter: `conversa_id=eq.${conversa.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversa?.id]);

  useEffect(() => {
    if (!id) return undefined;
    const channel = supabase
      .channel(`chamado-sat-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chamados', filter: `id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  async function send(e) {
    e.preventDefault();
    const body = texto.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      await enviarMensagemChamado(id, body, session.user.id);
      setTexto('');
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file) {
    if (!file) return;
    setSending(true);
    setError('');
    try {
      await enviarArquivoChamado({
        chamadoId: id,
        condominioId: condoId,
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

  async function setTicketStatus(next) {
    if (!next || next === chamado.status) return;
    const { error: err } = await supabase.from('chamados').update({
      status: next,
      data_resolucao: next === 'resolvido' ? new Date().toISOString() : chamado.data_resolucao,
      resolvido_por: next === 'resolvido' ? session.user.id : chamado.resolvido_por,
    }).eq('id', id);
    if (err) return setError(err.message);
    await supabase.from('chamado_status_historico').insert({
      chamado_id: id,
      status_anterior: chamado.status,
      status_novo: next,
      alterado_por: session.user.id,
    });
    load();
  }

  async function avaliar(estrelas) {
    if (!id || satBusy) return;
    setSatBusy(true);
    setSatError('');
    try {
      await avaliarChamado(id, estrelas);
      setChamado((prev) => prev ? {
        ...prev,
        satisfacao_estrelas: estrelas,
        satisfacao_em: new Date().toISOString(),
      } : prev);
    } catch (err) {
      setSatError(err.message || 'Não foi possível salvar a avaliação.');
    } finally {
      setSatBusy(false);
    }
  }

  if (!chamado) return <Page title="Chamado"><Alert error={error} /></Page>;

  const podeAvaliar = ehMorador
    && chamado.solicitante_id === session.user.id
    && ocorrenciaConcluida(chamado);
  const daAdmin = ehChamadoAdministracao(chamado);

  return (
    <div className="chamado-page">
      <Alert error={error} />
      <div className="chamado-layout">
        <aside className="chamado-side">
          <StatusPicker value={chamado.status} editable={canStatus} onChange={setTicketStatus} />
          {daAdmin ? <ChamadoAdminTag /> : null}
          {laudo && can(cargoTipo, 'view_laudos') ? (
            <Btn to={`/governanca-tecnica/${laudo.id}`} variant="ghost" icon="clipboard">
              Chat do laudo
            </Btn>
          ) : null}
          {can(cargoTipo, 'manage_traceability') ? (
            <Btn to={`/rastreabilidade/${id}`} variant="ghost" icon="layers">Rastreabilidade</Btn>
          ) : null}
          {canLaudo && !laudo ? (
            <Btn icon="clipboard" onClick={() => setLaudoModal(true)}>Criar laudo</Btn>
          ) : null}
          {historico.length ? (
            <details className="chamado-tl">
              <summary>Histórico</summary>
              <div className="timeline">
                {historico.map((h) => (
                  <div className="tl-item" key={h.id}>
                    <span className="dot" />
                    <div>
                      <strong>{STATUS_LABEL[h.status_novo] || h.status_novo}</strong>
                      <div className="muted">{formatDateTime(h.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </aside>

        <section className="chat-shell">
          <div className="chat-top">
            <ChatHeader
              title={chamado.titulo}
              subtitle={`${chamadoNumero(chamado.numero_registro)} · ${nomeSolicitanteChamado(chamado, { administracao: daAdmin })}${labelUnidade(chamado.unidades) ? ` · ${labelUnidade(chamado.unidades)}` : ''}`}
            >
              {podeAgendar ? (
                <Btn variant="ghost" icon="calendar" onClick={() => setVisitaModal(true)}>
                  Agendar visita
                </Btn>
              ) : null}
            </ChatHeader>
            {daAdmin ? <ChamadoAdminBanner /> : null}
            {podeAvaliar ? (
              <SatisfacaoChamado
                nota={notaSatisfacao(chamado.satisfacao_estrelas)}
                onRate={avaliar}
                busy={satBusy}
                error={satError}
              />
            ) : null}
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
              origemAdmin={daAdmin}
            />
          </div>
          <ChatComposer
            value={texto}
            onChange={setTexto}
            sending={sending}
            onSend={send}
            onFile={sendFile}
          />
        </section>
      </div>
      <AgendarVisitaModal
        open={visitaModal}
        onClose={() => setVisitaModal(false)}
        chamadoId={id}
        onScheduled={load}
      />
      <CriarLaudoModal
        open={laudoModal}
        onClose={() => setLaudoModal(false)}
        chamado={chamado}
      />
    </div>
  );
}
