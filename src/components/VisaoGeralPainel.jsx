import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { CARGO_LABEL, can, statusUi } from '../lib/permissions';
import { chamadoNumero, formatDate, maintenanceTone } from '../lib/format';
import { Badge } from './ui';
import { Icon } from './icons';

const TOM_MANUTENCAO = {
  inativa: 'Inativa',
  atrasada: 'Atrasada',
  proxima: 'Próxima',
  em_dia: 'Em dia',
};

function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function primeiroNome(nome) {
  const part = String(nome || '').trim().split(/\s+/)[0];
  return part || 'bem-vindo';
}

function atalhosPara(cargoTipo) {
  const t = String(cargoTipo || '').toLowerCase();
  if (t === 'morador') {
    return [
      { to: '/chamados/novo', icon: 'plus', label: 'Abrir chamado', hint: 'Registrar uma ocorrência' },
      { to: '/chamados', icon: 'message', label: 'Meus chamados', hint: 'Acompanhar atendimentos' },
      { to: '/documentos', icon: 'folder', label: 'Documentos', hint: 'Manuais e arquivos' },
      { to: '/boletins', icon: 'newspaper', label: 'Boletins', hint: 'Comunicados do condomínio' },
      { to: '/contatos', icon: 'phone', label: 'Contatos', hint: 'Telefones úteis' },
      { to: '/empreendimento', icon: 'building', label: 'Empreendimento', hint: 'Sobre o local' },
    ];
  }
  if (can(t, 'manage_traceability')) {
    return [
      { to: '/chamados', icon: 'message', label: 'Chamados', hint: 'Fila de ocorrências' },
      { to: '/agendar-visita', icon: 'calendar', label: 'Agendar visita', hint: 'Marcar inspeção' },
      { to: '/rastreabilidade', icon: 'layers', label: 'Rastreabilidade', hint: 'Linha do tempo' },
      { to: '/relatorio', icon: 'file', label: 'Relatório', hint: 'Ocorrências do período' },
      { to: '/manutencao', icon: 'wrench', label: 'Manutenções', hint: 'Agenda preventiva' },
      { to: '/usuarios', icon: 'users', label: 'Usuários', hint: 'Acessos do condomínio' },
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

export function VisaoGeralPainel() {
  const { condoId, condo, branding, profile, cargoTipo, session } = useSession();
  const [stats, setStats] = useState({ aberto: 0, andamento: 0, concluido: 0, manutencoes: 0 });
  const [chamados, setChamados] = useState([]);
  const [boletins, setBoletins] = useState([]);
  const [manutencoes, setManutencoes] = useState([]);
  const [contatos, setContatos] = useState([]);
  const verTodosChamados = can(cargoTipo, 'view_all_tickets');
  const atalhos = atalhosPara(cargoTipo);
  const dataHoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  useEffect(() => {
    if (!condoId || !session?.user?.id) return undefined;
    let live = true;
    (async () => {
      let statsQ = supabase
        .from('chamados')
        .select('status')
        .eq('condominio_id', condoId);
      if (!verTodosChamados) statsQ = statsQ.eq('solicitante_id', session.user.id);

      let chamadosQ = supabase
        .from('chamados')
        .select('id, numero_registro, titulo, status, updated_at')
        .eq('condominio_id', condoId)
        .order('updated_at', { ascending: false })
        .limit(5);
      if (!verTodosChamados) chamadosQ = chamadosQ.eq('solicitante_id', session.user.id);

      const [statsRes, chamadosRes, boletinsRes, manutRes, manutCountRes, contatosRes] = await Promise.all([
        statsQ,
        chamadosQ,
        supabase
          .from('boletins_informativos')
          .select('id, titulo, subtitulo, data_publicacao, created_at')
          .eq('condominio_id', condoId)
          .eq('publicado', true)
          .order('data_publicacao', { ascending: false })
          .limit(4),
        supabase
          .from('manutencoes_preventivas')
          .select('id, sistema, tipo, proxima_execucao, ativo')
          .eq('condominio_id', condoId)
          .eq('ativo', true)
          .order('proxima_execucao', { ascending: true })
          .limit(4),
        supabase
          .from('manutencoes_preventivas')
          .select('id', { count: 'exact', head: true })
          .eq('condominio_id', condoId)
          .eq('ativo', true),
        supabase
          .from('contatos')
          .select('id, nome, subtitulo, telefone, email, ativo')
          .eq('condominio_id', condoId)
          .order('ordem', { ascending: true })
          .limit(8),
      ]);
      if (!live) return;

      const listaChamados = dadosDe(chamadosRes);
      let aberto = 0;
      let andamento = 0;
      let concluido = 0;
      for (const row of dadosDe(statsRes)) {
        const ui = statusUi(row.status);
        if (ui.id === 'aberto') aberto += 1;
        else if (ui.id === 'em_execucao') andamento += 1;
        else if (ui.id === 'resolvido' || ui.id === 'encerrado') concluido += 1;
      }

      setStats({
        aberto,
        andamento,
        concluido,
        manutencoes: manutCountRes.count ?? dadosDe(manutRes).length,
      });
      setChamados(listaChamados);
      setBoletins(dadosDe(boletinsRes));
      setManutencoes(dadosDe(manutRes));
      setContatos(dadosDe(contatosRes).filter((row) => row.ativo !== false).slice(0, 4));
    })();
    return () => {
      live = false;
    };
  }, [condoId, session?.user?.id, verTodosChamados]);

  const nomeCondo = branding?.nome || condo?.nome || 'Condomínio';
  const cargo = CARGO_LABEL[cargoTipo] || cargoTipo || 'Usuário';
  const dataFormatada = dataHoje.charAt(0).toUpperCase() + dataHoje.slice(1);

  return (
    <div className="vg-painel">
      <section className="vg-welcome">
        <p className="vg-kicker">{dataFormatada}</p>
        <h2>{saudacao()}, {primeiroNome(profile?.nome)}</h2>
        <p className="vg-welcome-meta">
          {nomeCondo}
          <span aria-hidden="true"> · </span>
          {cargo}
        </p>
      </section>

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
            <h3>{verTodosChamados ? 'Chamados recentes' : 'Seus chamados'}</h3>
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
                      <Badge value={row.status} />
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
                      {[row.subtitulo, row.telefone, row.email].filter(Boolean).join(' · ')}
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
