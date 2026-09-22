import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { ehChamadoAdministracao } from '../lib/permissions';
import {
  chamadoNumero,
  formatDate,
  labelUnidade,
  nomePessoa,
  nomeSolicitanteChamado,
  rotuloLaudoUnidade,
  rotuloSolicitanteUnidade,
} from '../lib/format';
import {
  anexarArquivosNasMensagens,
  carregarEventosChatChamado,
  carregarLaudoGovernanca,
  enviarArquivoLaudo,
  enviarMensagemLaudo,
  garantirChatLaudo,
  hidratarNomesChamados,
  hidratarNomesMensagens,
  hidratarFotosMensagens,
  juntarMensagensComAbertura,
  juntarMensagensComAberturaLaudo,
  listarArquivosAberturaLaudo,
  listarChamadosCondominio,
  listarLaudosGovernanca,
  listarMensagensChamadoWatch,
  mapaUltimasMensagensChamados,
  mapNomesUsuarios,
  publicOrSignedUrl,
  resolverUrlArquivo,
} from '../lib/api';
import {
  classeListaConversa,
  mapaLeituraConversas,
  marcarConversaLidaPorLaudo,
} from '../lib/notifications';
import {
  loadBranding,
  loginPathDaConstrutora,
  nomeExibicaoConstrutora,
} from '../lib/branding';
import { Alert, APP_LOGO, Badge, Btn, ChamadoAdminBanner, ChamadoAdminTag, Empty, UserAvatar } from '../components/ui';
import { Icon } from '../components/icons';
import { ChatComposer, ChatHeader, ChatLog, LaudoThread, LaudoThumb } from '../components/Chat';
import { UnreadOrb } from '../components/UnreadOrb';

function termoKey(userId, laudoId) {
  return `cca.termoLaudo.${userId}.${laudoId}`;
}

function tipoDocumentoLaudo(laudo) {
  const blob = `${laudo?.titulo || ''} ${laudo?.tipo || ''} ${laudo?.categoria || ''}`.toLowerCase();
  if (/progn/.test(blob)) return 'Prognóstico';
  if (/diagn/.test(blob)) return 'Diagnóstico';
  if (/parecer/.test(blob)) return 'Parecer técnico';
  return 'Laudo técnico';
}

function arquivosDoLaudo(laudo, abertura) {
  const seen = new Set();
  const out = [];
  for (const file of [laudo?.capa, ...(abertura || [])]) {
    if (!file) continue;
    const key = file.id || file.storage_path || file.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

async function urlDoArquivo(file) {
  if (file?.url) return file.url;
  if (!file?.storage_path) return '';
  const signed = await publicOrSignedUrl(file.storage_path);
  return signed.data?.signedUrl || '';
}

async function baixarArquivo(file) {
  const url = await urlDoArquivo(file);
  if (!url) return false;
  const a = document.createElement('a');
  a.href = url;
  a.download = file.nome_original || file.nome_arquivo || 'documento';
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

async function abrirArquivo(file) {
  const url = await urlDoArquivo(file);
  if (!url) return false;
  window.open(url, '_blank', 'noopener');
  return true;
}

const ASSINATURA_PROVISORIA = 'Ricardo Almeida';

function AssinaturaCaneta({ nome }) {
  const texto = String(nome || '').trim();
  if (!texto) return null;
  return (
    <p className="ct-sign-ink" aria-hidden="true">{texto}</p>
  );
}

function nomeArquivoLaudo(file) {
  return file?.nome_original || file?.nome_arquivo || 'Documento';
}

export function ConstrutoraCondoPage() {
  const { condoId: condoParam, chamadoId, laudoId } = useParams();
  const navigate = useNavigate();
  const {
    isConstrutoraOrg,
    memberships,
    selectCondo,
    session,
    profile,
    construtora,
    fotoUrl,
    signOut,
  } = useSession();

  const [condoBrand, setCondoBrand] = useState({ nome: '', logo: '' });
  const [error, setError] = useState('');
  const [laudos, setLaudos] = useState([]);
  const [chamados, setChamados] = useState([]);
  const [qGov, setQGov] = useState('');
  const [qOco, setQOco] = useState('');
  const [leituraLaudo, setLeituraLaudo] = useState({});
  const [leituraChamado, setLeituraChamado] = useState({});
  const [previews, setPreviews] = useState({});
  const [laudo, setLaudo] = useState(null);
  const [laudoMsgs, setLaudoMsgs] = useState([]);
  const [laudoLidaAte, setLaudoLidaAte] = useState(null);
  const [anexosLaudo, setAnexosLaudo] = useState([]);
  const [aceite, setAceite] = useState(false);
  const [chamado, setChamado] = useState(null);
  const [chamadoMsgs, setChamadoMsgs] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [visitas, setVisitas] = useState([]);
  const [chamadoLidaAte, setChamadoLidaAte] = useState(null);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const chatLogRef = useRef(null);

  const membership = (memberships || []).find((row) => row.condominio_id === condoParam);
  const condoNome = condoBrand.nome || membership?.condominios?.nome || 'Condomínio';
  const construtoraNome = nomeExibicaoConstrutora(construtora) || 'Construtora';
  const userName = profile?.nome || 'representante';
  const basePath = `/construtora/${condoParam}`;

  useEffect(() => {
    if (condoParam) selectCondo(condoParam);
  }, [condoParam]);

  useEffect(() => {
    if (!condoParam) return undefined;
    let live = true;
    loadBranding(condoParam).then((next) => {
      if (live) setCondoBrand(next);
    });
    return () => { live = false; };
  }, [condoParam]);

  async function loadListas() {
    if (!condoParam) return;
    try {
      const [gov, tickets] = await Promise.all([
        listarLaudosGovernanca(condoParam),
        listarChamadosCondominio(condoParam),
      ]);
      const named = await hidratarNomesChamados(tickets || []);
      setLaudos(gov || []);
      setChamados(named);
      const [map, last] = await Promise.all([
        mapaLeituraConversas(),
        mapaUltimasMensagensChamados(named.map((row) => row.id)),
      ]);
      setLeituraLaudo(map.byLaudo || {});
      setLeituraChamado(map.byChamado || {});
      setPreviews(last || {});
      setError('');
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os registros deste condomínio.');
      setLaudos([]);
      setChamados([]);
    }
  }

  async function loadLaudo(id) {
    if (!id) {
      setLaudo(null);
      setLaudoMsgs([]);
      setLaudoLidaAte(null);
      setAnexosLaudo([]);
      setAceite(false);
      return;
    }
    try {
      const data = await carregarLaudoGovernanca(id);
      if (!data) {
        setError('Laudo não encontrado.');
        setLaudo(null);
        setLaudoMsgs([]);
        return;
      }
      let gtNome = nomePessoa(data.usuarios) || data.criador_nome || '';
      if (!gtNome && data.criado_por) {
        const nomes = await mapNomesUsuarios([data.criado_por], data.condominio_id || condoParam);
        gtNome = nomes[data.criado_por] || '';
      }
      setLaudo({
        ...data,
        usuarios: { ...(data.usuarios || {}), nome: gtNome || data.usuarios?.nome || '' },
        criador_nome: gtNome || data.criador_nome || '',
      });
      setAceite(localStorage.getItem(termoKey(session.user.id, id)) === '1');
      const abertura = await listarArquivosAberturaLaudo(id).catch(() => []);
      const resolved = await Promise.all((abertura || []).map(resolverUrlArquivo));
      setAnexosLaudo(arquivosDoLaudo(data, resolved));
      const convId = await garantirChatLaudo(id, session.user.id);
      if (convId) {
        const part = await supabase
          .from('conversa_participantes')
          .select('ultima_leitura_em')
          .eq('conversa_id', convId)
          .eq('usuario_id', session.user.id)
          .maybeSingle();
        setLaudoLidaAte(part.data?.ultima_leitura_em || null);
        const msgs = await supabase
          .from('mensagens')
          .select('*, usuarios:usuario_id(nome)')
          .eq('conversa_id', convId)
          .order('created_at');
        const withFiles = await anexarArquivosNasMensagens(msgs.data || []);
        const joined = await juntarMensagensComAberturaLaudo(data, withFiles);
        const named = await hidratarNomesMensagens(joined, {
          condominioId: data.condominio_id || condoParam,
        });
        setLaudoMsgs(await hidratarFotosMensagens(named.mensagens));
        await marcarConversaLidaPorLaudo(id);
      } else {
        setLaudoMsgs([]);
      }
      const map = await mapaLeituraConversas();
      setLeituraLaudo(map.byLaudo || {});
      setError('');
    } catch (err) {
      setError(err.message || 'Não foi possível abrir este registro.');
      setLaudo(null);
      setLaudoMsgs([]);
    }
  }

  async function loadChamado(id) {
    if (!id) {
      setChamado(null);
      setChamadoMsgs([]);
      setHistorico([]);
      setVisitas([]);
      setChamadoLidaAte(null);
      return;
    }
    const { data, error: err } = await supabase
      .from('chamados')
      .select('*, usuarios:solicitante_id(id, nome, email, telefone), unidades(identificacao, bloco, andar), condominios(id, nome)')
      .eq('id', id)
      .single();
    if (err) {
      setError(err.message);
      setChamado(null);
      setChamadoMsgs([]);
      return;
    }
    const [ticket] = await hidratarNomesChamados([data]);
    setChamado(ticket);
    const eventos = await carregarEventosChatChamado(id);
    setHistorico(eventos.historico);
    setVisitas(eventos.visitas);
    try {
      const raw = await listarMensagensChamadoWatch(id);
      const withFiles = await anexarArquivosNasMensagens(raw);
      const joined = await juntarMensagensComAbertura(ticket, withFiles);
      const named = await hidratarNomesMensagens(joined, {
        solicitanteId: ticket.solicitante_id,
        solicitanteNome: ticket.usuarios?.nome,
        condominioId: ticket.condominio_id,
      });
      setChamadoMsgs(await hidratarFotosMensagens(named.mensagens));
      setChamadoLidaAte(null);
      setError('');
    } catch (chatErr) {
      setChamadoMsgs([]);
      setError(chatErr.message || 'Não foi possível acompanhar este chat.');
    }
  }

  useEffect(() => {
    if (!isConstrutoraOrg || !condoParam) return;
    loadListas();
  }, [isConstrutoraOrg, condoParam]);

  useEffect(() => {
    if (!isConstrutoraOrg) return;
    loadLaudo(laudoId);
  }, [laudoId, isConstrutoraOrg, session?.user?.id]);

  useEffect(() => {
    if (!isConstrutoraOrg) return;
    if (laudoId) {
      setChamado(null);
      setChamadoMsgs([]);
      return;
    }
    loadChamado(chamadoId);
  }, [chamadoId, laudoId, isConstrutoraOrg, session?.user?.id]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return undefined;
    const go = () => { el.scrollTop = el.scrollHeight; };
    go();
    const t = setTimeout(go, 250);
    return () => clearTimeout(t);
  }, [laudoMsgs, chamadoMsgs, historico, visitas, laudoId, chamadoId]);

  const govFiltrados = useMemo(() => laudos.filter((row) => {
    const text = `${rotuloLaudoUnidade(row)} ${row.titulo || ''} ${row.chamado_numero || row.chamados?.numero_registro || ''} ${row.criticidade || ''}`.toLowerCase();
    return text.includes(qGov.toLowerCase());
  }), [laudos, qGov]);

  const ocoFiltrados = useMemo(() => chamados.filter((row) => {
    const text = `${row.titulo} ${row.numero_registro} ${nomePessoa(row.usuarios)} ${rotuloSolicitanteUnidade(row)} ${previews[row.id] || ''}`.toLowerCase();
    return text.includes(qOco.toLowerCase());
  }), [chamados, qOco, previews]);

  function aceitarTermo() {
    if (aceite || !laudoId || !session?.user?.id) return;
    localStorage.setItem(termoKey(session.user.id, laudoId), '1');
    setAceite(true);
  }

  async function abrirDocumento(file) {
    if (!aceite) return;
    const alvo = file || anexosLaudo[0];
    if (!alvo) return;
    if (!(await abrirArquivo(alvo))) setError('Não foi possível abrir o documento.');
  }

  async function baixarUmArquivo(file) {
    if (!aceite) return;
    if (!(await baixarArquivo(file))) setError('Não foi possível baixar o documento.');
  }

  async function send(e) {
    e.preventDefault();
    const body = texto.trim();
    if (!body || !laudoId || sending) return;
    setSending(true);
    setError('');
    try {
      await enviarMensagemLaudo(laudoId, body, session.user.id);
      setTexto('');
      await Promise.all([loadLaudo(laudoId), loadListas()]);
    } catch (err) {
      setError(err.message || 'Não foi possível enviar.');
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file) {
    if (!file || !laudoId) return;
    setSending(true);
    setError('');
    try {
      await enviarArquivoLaudo({
        laudoId,
        condominioId: condoParam || laudo?.condominio_id,
        userId: session.user.id,
        file,
      });
      await Promise.all([loadLaudo(laudoId), loadListas()]);
    } catch (err) {
      setError(err.message || 'Não foi possível enviar o arquivo.');
    } finally {
      setSending(false);
    }
  }

  if (!isConstrutoraOrg) return <Navigate to="/" replace />;
  if (!condoParam) return <Navigate to="/" replace />;
  if (memberships?.length && !membership) {
    return (
      <div className="ct-work">
        <Alert error="Este condomínio não está no seu escopo." />
        <Btn variant="ghost" to="/">Voltar aos condomínios</Btn>
      </div>
    );
  }

  const tipoDoc = tipoDocumentoLaudo(laudo);
  const unidadeLaudo = laudo ? rotuloLaudoUnidade(laudo) : '';

  return (
    <div className="ct-work">
      <header className="ct-work-bar">
        <div className="ct-work-brand">
          <Btn variant="ghost" icon="building" onClick={() => navigate('/')}>
            Condomínios
          </Btn>
          <span className="ct-work-sep" aria-hidden="true" />
          {condoBrand.logo ? (
            <img className="ct-work-logo" src={condoBrand.logo} alt="" />
          ) : null}
          <strong>{condoNome}</strong>
        </div>
        <div className="ct-work-end">
          <UserAvatar src={fotoUrl} nome={profile?.nome} size={32} />
          <span className="muted">{profile?.nome}</span>
          <Btn
            variant="ghost"
            icon="logout"
            onClick={async () => {
              await signOut({
                to: loginPathDaConstrutora(construtoraNome, construtora?.id),
              });
            }}
          >
            Sair
          </Btn>
        </div>
      </header>

      <Alert error={error} />

      <div className="ct-split">
        <section className="ct-pane ct-pane--gov">
          {laudoId && laudo ? (
            <div className="ct-termo-wrap">
              <header className="ct-pane-head">
                <Btn variant="ghost" onClick={() => navigate(basePath)}>Voltar</Btn>
                <span className="ct-pane-kicker">Governança técnica</span>
              </header>
              <article className="ct-termo">
                <img className="ct-termo-logo" src={APP_LOGO} alt="CCA" />
                <p className="ct-termo-kicker">CCA Unificado · Gestão Técnica</p>
                <h2>Termo de recebimento</h2>
                <p className="ct-termo-doc">{tipoDoc}</p>
                <div className="ct-termo-body">
                  <p>
                    Eu, <em>{userName}</em>, na qualidade de representante da construtora{' '}
                    <em>{construtoraNome}</em>, declaro que recebi o {tipoDoc.toLowerCase()} referente a{' '}
                    <em>{unidadeLaudo || laudo.titulo || 'este registro'}</em>, emitido pela Gestão Técnica da CCA
                    para o condomínio <em>{condoNome}</em>, nesta data de {formatDate(new Date())}.
                  </p>
                  <p>
                    Declaro estar ciente do conteúdo técnico apresentado, das recomendações nele contidas e das
                    responsabilidades que dele decorrem para as partes envolvidas.
                  </p>
                  <p>
                    O aceite abaixo autoriza o download do documento original (laudo, prognóstico ou diagnóstico)
                    para arquivo da construtora.
                  </p>
                </div>
                <div className="ct-termo-signs">
                  <div className="ct-termo-sign">
                    <AssinaturaCaneta nome={ASSINATURA_PROVISORIA} />
                    <span className="ct-sign-line" aria-hidden="true" />
                    <small>{construtoraNome}</small>
                  </div>
                </div>
              </article>
              <label className={`ct-termo-check${aceite ? ' is-locked' : ''}`}>
                <input
                  type="checkbox"
                  checked={aceite}
                  disabled={aceite}
                  onChange={(e) => {
                    if (e.target.checked) aceitarTermo();
                  }}
                />
                <span>Li e concordo com o termo de recebimento.</span>
              </label>
              {!aceite ? (
                <p className="ct-termo-lock-hint">
                  Marque o termo para abrir ou baixar o {tipoDoc.toLowerCase()}. Sem o aceite, o documento permanece bloqueado.
                </p>
              ) : !anexosLaudo.length ? (
                <p className="ct-termo-lock-hint">Documento ainda não anexado.</p>
              ) : (
                <ul className="ct-termo-files">
                  {anexosLaudo.map((file) => {
                    const key = file.id || file.storage_path || nomeArquivoLaudo(file);
                    return (
                      <li key={key}>
                        <span>{nomeArquivoLaudo(file)}</span>
                        <div>
                          <Btn variant="ghost" icon="file" onClick={() => abrirDocumento(file)}>Abrir</Btn>
                          <Btn icon="download" onClick={() => baixarUmArquivo(file)}>Baixar</Btn>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <>
              <header className="ct-pane-head">
                <div>
                  <h2>Governança técnica</h2>
                </div>
              </header>
              <label className="search-field ct-search">
                <Icon name="search" size={16} />
                <input
                  placeholder="Pesquisar unidade ou laudo"
                  value={qGov}
                  onChange={(e) => setQGov(e.target.value)}
                />
              </label>
              <div className="ct-list">
                {!govFiltrados.length ? (
                  <Empty text="Nenhum registro de governança técnica." />
                ) : govFiltrados.map((row) => {
                  const estado = leituraLaudo[row.id]?.estado || 'lida';
                  const unread = estado === 'nova' || estado === 'nao_lida';
                  return (
                    <button
                      type="button"
                      key={row.id}
                      className={`suporte-item laudo-item${row.id === laudoId ? ' active' : ''} ${classeListaConversa(estado)}`.trim()}
                      onClick={() => navigate(`${basePath}/governanca/${row.id}`)}
                    >
                      {unread ? (
                        <UnreadOrb
                          count={leituraLaudo[row.id]?.nao_lidas || 1}
                          variant={estado === 'nova' ? 'nova' : 'alerta'}
                          title={estado === 'nova' ? 'Conversa nova' : 'Mensagens novas'}
                        />
                      ) : null}
                      <LaudoThumb capa={row.capa} />
                      <div className="laudo-item-copy">
                        <strong className="suporte-item-name">{rotuloLaudoUnidade(row)}</strong>
                        <small className="suporte-item-preview">
                          {tipoDocumentoLaudo(row)} · {chamadoNumero(row.chamados?.numero_registro ?? row.chamado_numero)}
                        </small>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <section className="ct-pane ct-pane--chat">
          {laudoId && laudo ? (
            <div className="chat-shell suporte-chat">
              <ChatHeader
                icon="clipboard"
                title={rotuloLaudoUnidade(laudo)}
                subtitle={`${tipoDoc} · ${chamadoNumero(laudo.chamados?.numero_registro ?? laudo.chamado_numero)}`}
              />
              <div className="chat-log laudo-log" ref={chatLogRef}>
                <LaudoThread
                  mensagens={laudoMsgs}
                  sessionUserId={session.user.id}
                  lidaAte={laudoLidaAte}
                  bloquearDocumento={!aceite}
                  empty="Nenhuma conversa ainda. Tire dúvidas com a Gestão Técnica."
                />
              </div>
              <ChatComposer
                value={texto}
                onChange={setTexto}
                sending={sending}
                onSend={send}
                onFile={sendFile}
                placeholder="Escreva para a Gestão Técnica"
              />
            </div>
          ) : chamadoId && chamado ? (
            <div className="chat-shell suporte-chat">
              <ChatHeader
                title={chamado.titulo}
                subtitle={[
                  ehChamadoAdministracao(chamado) ? null : nomeSolicitanteChamado(chamado),
                  labelUnidade(chamado.unidades),
                ].filter(Boolean).join(' · ') || undefined}
              >
                <Badge value={chamado.status} />
              </ChatHeader>
              {ehChamadoAdministracao(chamado) ? <ChamadoAdminBanner /> : null}
              <div className="chat-log" ref={chatLogRef}>
                <ChatLog
                  mensagens={chamadoMsgs}
                  historico={historico}
                  visitas={visitas}
                  sessionUserId={session.user.id}
                  lidaAte={chamadoLidaAte}
                  solicitanteId={chamado.solicitante_id}
                  solicitanteNome={nomePessoa(chamado.usuarios)}
                  origemAdmin={ehChamadoAdministracao(chamado)}
                  comFoto
                  equipeADireita
                  empty="Nenhuma mensagem ainda."
                />
              </div>
              <p className="ct-watch-hint">
                A construtora acompanha esta conversa, sem participar.
              </p>
            </div>
          ) : (
            <>
              <header className="ct-pane-head">
                <div>
                  <h2>Ocorrências</h2>
                  <p>Chamados do condomínio. Acompanhe o chat sem participar.</p>
                </div>
              </header>
              <label className="search-field ct-search">
                <Icon name="search" size={16} />
                <input
                  placeholder="Pesquisar ocorrência, morador ou ID"
                  value={qOco}
                  onChange={(e) => setQOco(e.target.value)}
                />
              </label>
              <div className="ct-list">
                {!ocoFiltrados.length ? (
                  <Empty text="Nenhuma ocorrência neste condomínio." />
                ) : ocoFiltrados.map((row) => {
                  const estado = leituraChamado[row.id]?.estado || 'lida';
                  const unread = estado === 'nova' || estado === 'nao_lida';
                  const daAdmin = ehChamadoAdministracao(row);
                  return (
                    <button
                      type="button"
                      key={row.id}
                      className={`suporte-item${daAdmin ? ' suporte-item--admin' : ''}${row.id === chamadoId ? ' active' : ''} ${classeListaConversa(estado)}`.trim()}
                      onClick={() => navigate(`${basePath}/ocorrencias/${row.id}`)}
                    >
                      {unread ? (
                        <UnreadOrb
                          count={leituraChamado[row.id]?.nao_lidas || 1}
                          variant={estado === 'nova' ? 'nova' : 'alerta'}
                          title={estado === 'nova' ? 'Conversa nova' : 'Mensagens novas'}
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
                        {previews[row.id] || row.titulo || 'Sem mensagens'}
                      </small>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
