import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { aplicarEscopoChamados, can, ehCargoAdministracao, ehCargoConstrutora, ehChamadoAdministracao, STATUS_LABEL, statusUi } from '../lib/permissions';
import { chamadoNumero, embedOne, formatDate, formatTelefone, labelUnidade, maintenanceTone, nomePessoa } from '../lib/format';
import { mapaLeituraConversas } from '../lib/notifications';
import { arquivoEhImagem, hidratarNomesMensagens, resolverUrlArquivo, resolverVisitaAgendadaChamado, resumoOperacionalCondominio } from '../lib/api';
import { previewTextoChat } from '../lib/chamadoRastreabilidade';
import { Badge, ChamadoAdminTag } from './ui';
import { Icon } from './icons';

const TOM_MANUTENCAO = {
  inativa: 'Inativa',
  atrasada: 'Atrasada',
  proxima: 'Próxima',
  em_dia: 'Em dia',
};

function atalhosPara(cargoTipo) {
  const t = String(cargoTipo || '').toLowerCase();
  if (ehCargoConstrutora(t)) {
    return [
      { to: '/governanca-tecnica', icon: 'clipboard', label: 'Governança técnica', hint: 'Laudos e chat com a Gestão Técnica' },
      { to: '/manutencao', icon: 'wrench', label: 'Manutenções', hint: 'Agenda preventiva' },
    ];
  }
  if (can(t, 'manage_traceability')) {
    return [
      { to: '/chamados', icon: 'message', label: 'Chamados', hint: 'Lista de chats e ocorrências' },
      { to: '/agendar-visita', icon: 'calendar', label: 'Agendar visita', hint: 'Marcar inspeção' },
      { to: '/rastreabilidade', icon: 'layers', label: 'Rastreabilidade', hint: 'Linha do tempo' },
      { to: '/relatorio', icon: 'file', label: 'Relatório', hint: 'Ocorrências do período' },
      { to: '/manutencao', icon: 'wrench', label: 'Manutenções', hint: 'Agenda preventiva' },
      { to: '/usuarios', icon: 'users', label: 'Usuários', hint: 'Acessos do condomínio' },
    ];
  }
  if (ehCargoAdministracao(t)) {
    return [
      { to: '/chamados/novo', icon: 'plus', label: 'Abrir chamado', hint: 'Problemas nas áreas comuns' },
      { to: '/chamados', icon: 'message', label: 'Chamados', hint: 'Fila da administração' },
      { to: '/manutencao', icon: 'wrench', label: 'Manutenções', hint: 'Agenda preventiva' },
      { to: '/documentos', icon: 'folder', label: 'Documentos', hint: 'Arquivos do empreendimento' },
      { to: '/boletins', icon: 'newspaper', label: 'Boletins', hint: 'Comunicados' },
      { to: '/contatos', icon: 'phone', label: 'Contatos', hint: 'Telefones úteis' },
    ];
  }
  return [
    { to: '/chamados', icon: 'message', label: 'Chamados', hint: 'Ocorrências do condomínio' },
    { to: '/manutencao', icon: 'wrench', label: 'Manutenções', hint: 'Agenda preventiva' },
    { to: '/documentos', icon: 'folder', label: 'Documentos', hint: 'Arquivos do empreendimento' },
    { to: '/boletins', icon: 'newspaper', label: 'Boletins', hint: 'Comunicados' },
    { to: '/contatos', icon: 'phone', label: 'Contatos', hint: 'Telefones úteis' },
    { to: '/garantias', icon: 'shield', label: 'Garantias', hint: 'Prazos e cobertura' },
  ];
}

function dadosDe(res) {
  return res?.data || [];
}

function dataBoletim(value) {
  if (!value) return { day: '—', month: '' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { day: '—', month: '' };
  return {
    day: String(d.getDate()).padStart(2, '0'),
    month: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
  };
}

function ehAtualizacao(row, leitura, notifIds) {
  const estado = leitura?.[row.id]?.estado;
  return estado === 'nova' || estado === 'nao_lida' || notifIds.has(row.id);
}

function chamadoEstaAberto(row) {
  const ui = statusUi(row?.status);
  return ui.id === 'aberto' || ui.id === 'em_execucao';
}

function chamadoDaVez(lista) {
  const rows = lista || [];
  return rows.find(chamadoEstaAberto) || rows[0] || null;
}

async function carregarMensagensChamado(chamado, condominioId) {
  if (!chamado?.id) return [];
  const conv = await supabase
    .from('conversas')
    .select('id')
    .eq('chamado_id', chamado.id)
    .maybeSingle();
  if (conv.error || !conv.data?.id) return [];
  let msgs = await supabase
    .from('mensagens')
    .select('id, texto, created_at, usuario_id, usuarios:usuario_id(nome)')
    .eq('conversa_id', conv.data.id)
    .order('created_at', { ascending: false })
    .limit(4);
  if (msgs.error) {
    msgs = await supabase
      .from('mensagens')
      .select('id, texto, created_at, usuario_id')
      .eq('conversa_id', conv.data.id)
      .order('created_at', { ascending: false })
      .limit(4);
  }
  if (msgs.error) return [];
  const recentes = (msgs.data || []).filter((m) => !m.excluido_em).reverse();
  try {
    const named = await hidratarNomesMensagens(recentes, {
      solicitanteId: chamado.solicitante_id,
      condominioId,
    });
    return named.mensagens || recentes;
  } catch {
    return recentes;
  }
}

function extensaoArquivo(arquivo, titulo) {
  const nome = arquivo?.nome_original || titulo || '';
  const mime = String(arquivo?.mime_type || '').toLowerCase();
  const ext = String(nome).split('.').pop()?.toLowerCase();
  if (ext && ext.length <= 5 && ext !== String(nome).toLowerCase()) return ext.toUpperCase();
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('word') || mime.includes('document')) return 'DOC';
  if (mime.includes('sheet') || mime.includes('excel')) return 'XLS';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'PPT';
  if (mime.includes('zip') || mime.includes('compressed')) return 'ZIP';
  if (mime.includes('image') || arquivoEhImagem(arquivo)) return 'IMG';
  return 'ARQ';
}

function tipoArquivo(ext) {
  const value = String(ext || '').toLowerCase();
  if (value === 'pdf') return 'pdf';
  if (['doc', 'docx', 'rtf', 'odt'].includes(value)) return 'doc';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(value)) return 'xls';
  if (['ppt', 'pptx', 'odp'].includes(value)) return 'ppt';
  if (['zip', 'rar', '7z'].includes(value)) return 'zip';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'img'].includes(value)) return 'img';
  return 'file';
}

function FileThumbPreview({ arquivo, titulo }) {
  const ext = extensaoArquivo(arquivo, titulo);
  const kind = tipoArquivo(ext);
  const isImage = arquivo?.url && (arquivo.isImage || arquivoEhImagem(arquivo));
  if (isImage) {
    return (
      <span className="vg-file-preview vg-file-preview--photo">
        <img src={arquivo.url} alt="" />
      </span>
    );
  }
  return (
    <span className={`vg-file-preview vg-file-preview--${kind}`} aria-hidden="true">
      <span className="vg-file-sheet">
        <span className="vg-file-sheet-fold" />
        <span className="vg-file-sheet-band">{ext}</span>
        <span className="vg-file-sheet-lines">
          <i /><i /><i /><i />
        </span>
      </span>
    </span>
  );
}

function VerTodos({ to, show }) {
  if (!show) return null;
  return <Link className="vg-ver-todos" to={to}>Ver todos</Link>;
}

export function VisaoGeralPainel() {
  const { condoId, cargoTipo, session } = useSession();
  const [stats, setStats] = useState({ aberto: 0, andamento: 0, concluido: 0, total: 0, manutencoes: 0, laudos: 0 });
  const [chamados, setChamados] = useState([]);
  const [atualizacoes, setAtualizacoes] = useState([]);
  const [boletins, setBoletins] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [conversaMsgs, setConversaMsgs] = useState([]);
  const [visitaAtual, setVisitaAtual] = useState(null);
  const [leituraChamados, setLeituraChamados] = useState({});
  const [manutencoes, setManutencoes] = useState([]);
  const [contatos, setContatos] = useState([]);
  const verTodosChamados = can(cargoTipo, 'view_all_tickets');
  const isMorador = String(cargoTipo || '').toLowerCase() === 'morador';
  const ehConstrutora = ehCargoConstrutora(cargoTipo);
  const ehAdminCondo = ehCargoAdministracao(cargoTipo);
  const atalhos = atalhosPara(cargoTipo);

  useEffect(() => {
    if (!condoId || !session?.user?.id) return undefined;
    let live = true;
    (async () => {
      if (ehConstrutora) {
        const [resumo, manutRes] = await Promise.all([
          resumoOperacionalCondominio(condoId),
          supabase
            .from('manutencoes_preventivas')
            .select('id, sistema, tipo, proxima_execucao, ativo')
            .eq('condominio_id', condoId)
            .eq('ativo', true)
            .order('proxima_execucao', { ascending: true })
            .limit(6),
        ]);
        if (!live) return;
        const listaManut = dadosDe(manutRes);
        setStats({
          aberto: resumo?.aberto || 0,
          andamento: resumo?.andamento || 0,
          concluido: resumo?.concluido || 0,
          total: resumo?.total || 0,
          manutencoes: resumo?.manutencoes ?? listaManut.length,
          laudos: resumo?.laudos || 0,
        });
        setChamados([]);
        setAtualizacoes([]);
        setBoletins([]);
        setDocumentos([]);
        setConversaMsgs([]);
        setVisitaAtual(null);
        setLeituraChamados({});
        setManutencoes(listaManut);
        setContatos([]);
        return;
      }

      let statsQ = supabase
        .from('chamados')
        .select('status, origem')
        .eq('condominio_id', condoId);
      statsQ = aplicarEscopoChamados(statsQ, cargoTipo, session.user.id);

      let chamadosQ = supabase
        .from('chamados')
        .select('id, numero_registro, titulo, descricao, status, updated_at, created_at, solicitante_id, origem, unidades(identificacao, bloco, andar)')
        .eq('condominio_id', condoId)
        .order('updated_at', { ascending: false })
        .limit(isMorador ? 12 : 5);
      chamadosQ = aplicarEscopoChamados(chamadosQ, cargoTipo, session.user.id);

      const [statsRes, chamadosRes, boletinsRes, manutRes, manutCountRes, contatosRes, leitura, notifRes, docsRes] = await Promise.all([
        statsQ,
        chamadosQ,
        supabase
          .from('boletins_informativos')
          .select('id, titulo, subtitulo, data_publicacao, created_at')
          .eq('condominio_id', condoId)
          .eq('publicado', true)
          .order('data_publicacao', { ascending: false })
          .limit(5),
        supabase
          .from('manutencoes_preventivas')
          .select('id, sistema, tipo, proxima_execucao, ativo')
          .eq('condominio_id', condoId)
          .eq('ativo', true)
          .order('proxima_execucao', { ascending: true })
          .limit(5),
        isMorador
          ? Promise.resolve({ count: 0 })
          : supabase
            .from('manutencoes_preventivas')
            .select('id', { count: 'exact', head: true })
            .eq('condominio_id', condoId)
            .eq('ativo', true),
        isMorador
          ? Promise.resolve({ data: [] })
          : supabase
            .from('contatos')
            .select('id, nome, subtitulo, telefone, email, ativo')
            .eq('condominio_id', condoId)
            .order('ordem', { ascending: true })
            .limit(8),
        isMorador ? mapaLeituraConversas().catch(() => ({ byChamado: {} })) : Promise.resolve({ byChamado: {} }),
        isMorador
          ? supabase
            .from('notificacoes')
            .select('id, tipo, ref_id, ref_tipo, lida_em')
            .eq('condominio_id', condoId)
            .in('tipo', ['status_chamado', 'mensagem'])
            .is('lida_em', null)
            .order('created_at', { ascending: false })
            .limit(20)
          : Promise.resolve({ data: [] }),
        isMorador
          ? supabase
            .from('documentos_empreendimento')
            .select('id, titulo, descricao, ordem, created_at, arquivos(*)')
            .eq('condominio_id', condoId)
            .order('ordem', { ascending: true })
            .limit(4)
          : Promise.resolve({ data: [] }),
      ]);
      if (!live) return;

      let listaChamados = dadosDe(chamadosRes);
      if (chamadosRes.error) {
        let fallback = supabase
          .from('chamados')
          .select('id, numero_registro, titulo, descricao, status, updated_at, created_at, solicitante_id, origem')
          .eq('condominio_id', condoId)
          .order('updated_at', { ascending: false })
          .limit(isMorador ? 12 : 5);
        fallback = aplicarEscopoChamados(fallback, cargoTipo, session.user.id);
        const plain = await fallback;
        listaChamados = dadosDe(plain);
      }
      if (ehAdminCondo) listaChamados = listaChamados.filter(ehChamadoAdministracao);
      let aberto = 0;
      let andamento = 0;
      let concluido = 0;
      for (const row of dadosDe(statsRes)) {
        const ui = statusUi(row.status);
        if (ui.id === 'aberto') aberto += 1;
        else if (ui.id === 'em_execucao') andamento += 1;
        else if (ui.id === 'resolvido' || ui.id === 'encerrado') concluido += 1;
      }

      const notifIds = new Set();
      for (const row of dadosDe(notifRes)) {
        if (row.ref_tipo === 'chamado' || row.tipo === 'status_chamado') {
          if (row.ref_id) notifIds.add(row.ref_id);
        }
      }

      setStats({
        aberto,
        andamento,
        concluido,
        manutencoes: manutCountRes.count ?? dadosDe(manutRes).length,
      });
      setChamados(listaChamados);
      setAtualizacoes(listaChamados.filter((row) => ehAtualizacao(row, leitura.byChamado, notifIds)).slice(0, 4));
      setBoletins(dadosDe(boletinsRes));
      setManutencoes(dadosDe(manutRes));
      setContatos(dadosDe(contatosRes).filter((row) => row.ativo !== false).slice(0, 4));
      const docs = await Promise.all(dadosDe(docsRes).map(async (row) => {
        const arquivo = embedOne(row.arquivos);
        return {
          ...row,
          arquivos: arquivo ? await resolverUrlArquivo(arquivo) : null,
        };
      }));
      if (!live) return;
      setDocumentos(docs);
      if (isMorador) {
        const destaque = chamadoDaVez(listaChamados);
        const msgs = await carregarMensagensChamado(destaque, condoId);
        const visita = destaque
          ? await resolverVisitaAgendadaChamado(destaque.id, msgs).catch(() => null)
          : null;
        if (!live) return;
        setConversaMsgs(msgs);
        setVisitaAtual(visita || null);
        setLeituraChamados(leitura.byChamado || {});
      } else {
        setConversaMsgs([]);
        setVisitaAtual(null);
        setLeituraChamados({});
      }
    })();
    return () => {
      live = false;
    };
  }, [condoId, session?.user?.id, verTodosChamados, isMorador, ehConstrutora, cargoTipo, ehAdminCondo]);

  if (ehConstrutora) {
    return (
      <div className="vg-painel vg-painel--construtora">
        <section className="vg-shortcuts" aria-label="Atalhos">
          {atalhos.map((item) => (
            <Link key={item.to} className="vg-shortcut" to={item.to}>
              <span className="vg-shortcut-icon" aria-hidden="true">
                <Icon name={item.icon} size={20} />
              </span>
              <span className="vg-shortcut-copy">
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
            </Link>
          ))}
        </section>

        <section className="vg-kpis" aria-label="Números dos chamados">
          <article>
            <span>Chamados abertos</span>
            <strong>{stats.aberto}</strong>
          </article>
          <article>
            <span>Em andamento</span>
            <strong>{stats.andamento}</strong>
          </article>
          <article>
            <span>Concluídos</span>
            <strong>{stats.concluido}</strong>
          </article>
          <article>
            <span>Total de chamados</span>
            <strong>{stats.total}</strong>
          </article>
          <article>
            <span>Manutenções ativas</span>
            <strong>{stats.manutencoes}</strong>
          </article>
          <article>
            <span>Laudos</span>
            <strong>{stats.laudos}</strong>
          </article>
        </section>

        <section className="vg-card">
          <header className="vg-card-head">
            <h3>Próximas manutenções</h3>
            <Link to="/manutencao">Agenda</Link>
          </header>
          {!manutencoes.length ? (
            <p className="vg-empty">Nenhuma manutenção preventiva na agenda.</p>
          ) : (
            <ul className="vg-list">
              {manutencoes.map((row) => (
                <li key={row.id}>
                  <Link to="/manutencao">
                    <strong>{row.sistema || row.tipo || 'Manutenção'}</strong>
                    <small>
                      {[formatDate(row.proxima_execucao), row.tipo, TOM_MANUTENCAO[maintenanceTone(row)]]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  if (isMorador) {
    const boletinsVisiveis = boletins.slice(0, 4);
    const chamadoAtual = chamadoDaVez(chamados);
    const docsVisiveis = documentos.slice(0, 3);
    const manutVisiveis = manutencoes.slice(0, 4);
    const ultimaMsg = conversaMsgs.length
      ? conversaMsgs[conversaMsgs.length - 1]
      : (chamadoAtual?.descricao
        ? { texto: chamadoAtual.descricao, usuario_id: chamadoAtual.solicitante_id }
        : null);
    const leituraAtual = chamadoAtual ? leituraChamados[chamadoAtual.id] : null;
    const temMsgNova = leituraAtual?.estado === 'nova' || leituraAtual?.estado === 'nao_lida';
    return (
      <div className="vg-painel vg-painel--morador">
        <section className="vg-card vg-boletins" aria-label="Boletins informativos">
          <header className="vg-card-head">
            <h3>Boletins informativos</h3>
            <VerTodos to="/boletins" show={boletins.length > boletinsVisiveis.length} />
          </header>
          {!boletinsVisiveis.length ? (
            <p className="vg-empty">Nenhum boletim publicado ainda.</p>
          ) : (
            <ul className="vg-boletim-stack">
              {boletinsVisiveis.map((row, index) => {
                const data = dataBoletim(row.data_publicacao || row.created_at);
                return (
                  <li key={row.id}>
                    <Link className={`vg-boletim${index === 0 ? ' vg-boletim--destaque' : ''}`} to="/boletins">
                      <span className="vg-boletim-date" aria-hidden="true">
                        <strong>{data.day}</strong>
                        <small>{data.month}</small>
                      </span>
                      <span className="vg-boletim-copy">
                        <strong>{row.titulo}</strong>
                        {row.subtitulo ? <small>{row.subtitulo}</small> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {chamadoAtual ? (
          <section className="vg-card vg-boletins" aria-label="Assistência técnica">
            <header className="vg-card-head">
              <h3>Assistência técnica</h3>
              <VerTodos to="/assistencia-tecnica" show={chamados.length > 1} />
            </header>
            <Link className="vg-assist" to={`/chamados/${chamadoAtual.id}`}>
              <div className="vg-assist-top">
                <strong className="vg-assist-title">
                  {chamadoAtual.titulo || chamadoNumero(chamadoAtual.numero_registro)}
                </strong>
                <span className="vg-assist-flags">
                  {temMsgNova ? (
                    <span className={`vg-assist-new${leituraAtual?.estado === 'nova' ? ' vg-assist-new--nova' : ''}`}>
                      {leituraAtual?.estado === 'nova' ? 'Conversa nova' : 'Mensagens novas'}
                    </span>
                  ) : null}
                  {visitaAtual ? (
                    <span className="vg-assist-visit-dot" title="Há uma visita marcada" aria-label="Há uma visita marcada">
                      <Icon name="calendar" size={14} />
                      <i />
                    </span>
                  ) : null}
                </span>
              </div>
              {ultimaMsg ? (
                <span className="vg-assist-last">
                  <strong>
                    {ultimaMsg.usuario_id === session.user.id
                      ? 'Você'
                      : (nomePessoa(ultimaMsg.usuarios) || 'Equipe')}
                  </strong>
                  <small>{previewTextoChat(ultimaMsg.texto) || String(ultimaMsg.texto || '').trim() || 'Arquivo'}</small>
                </span>
              ) : (
                <span className="vg-assist-last">
                  <small>A conversa aparece aqui quando houver mensagens.</small>
                </span>
              )}
            </Link>
          </section>
        ) : null}

        <div className="vg-tiles">
          {!chamadoAtual ? (
            <Link className="vg-tile vg-tile--assist" to="/assistencia-tecnica">
              <span className="vg-tile-icon" aria-hidden="true">
                <Icon name="headset" size={22} />
              </span>
              <span className="vg-tile-copy">
                <strong>Assistência técnica</strong>
                <small>Abrir e acompanhar chamados</small>
              </span>
            </Link>
          ) : null}

          {docsVisiveis.length ? (
            <section className="vg-tile vg-tile--filled vg-tile--files" aria-label="Documentos">
              <header className="vg-tile-head">
                <h3>Documentos</h3>
                <VerTodos to="/documentos" show={documentos.length > docsVisiveis.length} />
              </header>
              <ul className="vg-file-thumbs">
                {docsVisiveis.map((row) => {
                  const arquivo = row.arquivos;
                  const nome = row.titulo || arquivo?.nome_original || 'Arquivo';
                  return (
                    <li key={row.id}>
                      <Link className="vg-file-thumb" to="/documentos" title={nome}>
                        <FileThumbPreview arquivo={arquivo} titulo={row.titulo} />
                        <span>{nome}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <Link className="vg-tile" to="/documentos">
              <span className="vg-tile-icon" aria-hidden="true">
                <Icon name="folder" size={22} />
              </span>
              <span className="vg-tile-copy">
                <strong>Documentos</strong>
                <small>Manuais e arquivos do condomínio</small>
              </span>
            </Link>
          )}
        </div>

        {atualizacoes.length ? (
          <section className="vg-card" aria-label="Atualizações do meu chamado">
            <header className="vg-card-head">
              <h3>Atualizações do meu chamado</h3>
              <VerTodos to="/assistencia-tecnica" show={chamados.length > atualizacoes.length} />
            </header>
            <ul className="vg-list">
              {atualizacoes.map((row) => (
                <li key={row.id}>
                  <Link to={`/chamados/${row.id}`}>
                    <span className="vg-list-row">
                      <strong>{row.titulo || chamadoNumero(row.numero_registro)}</strong>
                      <Badge value={row.status} />
                    </span>
                    <small>{chamadoNumero(row.numero_registro)} · {formatDate(row.updated_at)}</small>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="vg-card" aria-label="Manutenções agendadas">
          <header className="vg-card-head">
            <h3>Manutenções agendadas</h3>
            <VerTodos to="/manutencao" show={manutencoes.length > manutVisiveis.length} />
          </header>
          {!manutVisiveis.length ? (
            <p className="vg-empty">Nenhuma manutenção preventiva na agenda.</p>
          ) : (
            <ul className="vg-list">
              {manutVisiveis.map((row) => (
                <li key={row.id}>
                  <Link to="/manutencao">
                    <span className="vg-list-row">
                      <strong>{row.sistema || row.tipo || 'Manutenção'}</strong>
                      <span className="vg-manut-date">{formatDate(row.proxima_execucao)}</span>
                    </span>
                    <small>
                      {[row.tipo, TOM_MANUTENCAO[maintenanceTone(row)]]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="vg-painel">
      <section className="vg-shortcuts" aria-label="Atalhos">
        {atalhos.map((item) => (
          <Link key={item.to} className="vg-shortcut" to={item.to}>
            <span className="vg-shortcut-icon" aria-hidden="true">
              <Icon name={item.icon} size={20} />
            </span>
            <span className="vg-shortcut-copy">
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </span>
          </Link>
        ))}
      </section>

      <section className="vg-kpis" aria-label="Resumo">
        <article>
          <span>{verTodosChamados ? 'Chamados abertos' : 'Abertos'}</span>
          <strong>{stats.aberto}</strong>
        </article>
        <article>
          <span>Em andamento</span>
          <strong>{stats.andamento}</strong>
        </article>
        <article>
          <span>Concluídos</span>
          <strong>{stats.concluido}</strong>
        </article>
        <article>
          <span>Manutenções ativas</span>
          <strong>{stats.manutencoes}</strong>
        </article>
      </section>

      <div className="vg-columns">
        <section className="vg-card">
          <header className="vg-card-head">
            <h3>{ehAdminCondo ? 'Chamados da administração' : (verTodosChamados ? 'Chamados recentes' : 'Seus chamados')}</h3>
            <Link to="/chamados">Ver todos</Link>
          </header>
          {!chamados.length ? (
            <p className="vg-empty">Nenhum chamado no momento.</p>
          ) : (
            <ul className="vg-list">
              {chamados.map((row) => (
                <li key={row.id}>
                  <Link to={`/chamados/${row.id}`}>
                    <span className="vg-list-row">
                      <strong>{row.titulo || chamadoNumero(row.numero_registro)}</strong>
                      <span className="ticket-card-tags">
                        {ehChamadoAdministracao(row) ? <ChamadoAdminTag compact /> : null}
                        <Badge value={row.status} />
                      </span>
                    </span>
                    <small>{chamadoNumero(row.numero_registro)} · {formatDate(row.updated_at)}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="vg-card">
          <header className="vg-card-head">
            <h3>Próximas manutenções</h3>
            <Link to="/manutencao">Agenda</Link>
          </header>
          {!manutencoes.length ? (
            <p className="vg-empty">Nenhuma manutenção preventiva na agenda.</p>
          ) : (
            <ul className="vg-list">
              {manutencoes.map((row) => (
                <li key={row.id}>
                  <Link to="/manutencao">
                    <strong>{row.sistema || row.tipo || 'Manutenção'}</strong>
                    <small>
                      {[formatDate(row.proxima_execucao), row.tipo, TOM_MANUTENCAO[maintenanceTone(row)]]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="vg-card">
          <header className="vg-card-head">
            <h3>Boletins recentes</h3>
            <Link to="/boletins">Ver todos</Link>
          </header>
          {!boletins.length ? (
            <p className="vg-empty">Nenhum boletim publicado ainda.</p>
          ) : (
            <ul className="vg-list">
              {boletins.map((row) => (
                <li key={row.id}>
                  <Link to="/boletins">
                    <strong>{row.titulo}</strong>
                    <small>
                      {[row.subtitulo, formatDate(row.data_publicacao || row.created_at)].filter(Boolean).join(' · ')}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="vg-card">
          <header className="vg-card-head">
            <h3>Contatos úteis</h3>
            <Link to="/contatos">Lista</Link>
          </header>
          {!contatos.length ? (
            <p className="vg-empty">Nenhum contato cadastrado.</p>
          ) : (
            <ul className="vg-list">
              {contatos.map((row) => (
                <li key={row.id}>
                  <Link to="/contatos">
                    <strong>{row.nome}</strong>
                    <small>
                      {[row.subtitulo, row.telefone ? formatTelefone(row.telefone) || row.telefone : '', row.email].filter(Boolean).join(' · ')}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
