import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can } from '../lib/permissions';
import { formatDate, maintenanceTone } from '../lib/format';
import { Badge, Btn, CoverHero, Empty } from '../components/ui';
import { Icon } from '../components/icons';

export function DashboardPage() {
  const { condoId, cargoTipo, isGestaoTecnica, branding } = useSession();
  const [stats, setStats] = useState(null);
  const [chamados, setChamados] = useState([]);
  const [manutencoes, setManutencoes] = useState([]);

  useEffect(() => {
    if (!condoId) return;
    let live = true;
    (async () => {
      const queries = await Promise.all([
        supabase.from('chamados').select('status', { count: 'exact', head: false }).eq('condominio_id', condoId),
        supabase.from('usuarios').select('id', { count: 'exact', head: true }),
        supabase.from('unidades').select('id', { count: 'exact', head: true }).eq('condominio_id', condoId),
        supabase.from('fornecedores').select('id', { count: 'exact', head: true }).eq('condominio_id', condoId),
        supabase.from('materiais').select('id', { count: 'exact', head: true }).eq('condominio_id', condoId),
        supabase.from('garantias').select('id', { count: 'exact', head: true }).eq('condominio_id', condoId),
        supabase.from('chamados').select('id, numero_registro, titulo, status, updated_at').eq('condominio_id', condoId).order('updated_at', { ascending: false }).limit(8),
        supabase.from('manutencoes_preventivas').select('*').eq('condominio_id', condoId).eq('ativo', true).order('proxima_execucao', { ascending: true }).limit(6),
      ]);
      if (!live) return;
      const byStatus = {};
      for (const row of queries[0].data || []) {
        byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      }
      setStats({
        aberto: byStatus.aberto || 0,
        analise: byStatus.em_analise || 0,
        execucao: byStatus.em_execucao || 0,
        resolvido: byStatus.resolvido || 0,
        unidades: queries[2].count || 0,
        fornecedores: queries[3].count || 0,
        materiais: queries[4].count || 0,
        garantias: queries[5].count || 0,
      });
      setChamados(queries[6].data || []);
      setManutencoes(queries[7].data || []);
    })();
    return () => {
      live = false;
    };
  }, [condoId]);

  if (isGestaoTecnica && !condoId) {
    return <Navigate to="/" replace />;
  }

  if (!can(cargoTipo, 'dashboard_ops')) {
    return (
      <section className="page page-dashboard">
        <CoverHero src={branding?.capa || branding?.visaoGeral} alt="Capa" />
        <div className="page-head">
          <h1>Início</h1>
          <p>Acompanhe o condomínio e seus chamados.</p>
        </div>
        <div className="page-body">
          <div className="row">
            {can(cargoTipo, 'create_ticket') ? <Btn to="/chamados/novo" icon="plus">Abrir chamado</Btn> : null}
            <Btn variant="ghost" to="/visao-geral" icon="home">Ver visão geral</Btn>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page page-dashboard">
      <CoverHero src={branding?.capa || branding?.visaoGeral} alt="Capa do condomínio" />
      <div className="page-head">
        <h1>Dashboard</h1>
        <p>Indicadores operacionais do condomínio.</p>
      </div>
      <div className="page-body">
        <div className="stats">
          <article className="stat"><span className="stat-label"><Icon name="message" size={15} />Abertos</span><strong>{stats?.aberto ?? '—'}</strong></article>
          <article className="stat"><span className="stat-label"><Icon name="search" size={15} />Em análise</span><strong>{stats?.analise ?? '—'}</strong></article>
          <article className="stat"><span className="stat-label"><Icon name="wrench" size={15} />Em execução</span><strong>{stats?.execucao ?? '—'}</strong></article>
          <article className="stat"><span className="stat-label"><Icon name="check" size={15} />Resolvidos</span><strong>{stats?.resolvido ?? '—'}</strong></article>
        </div>
        <div className="stats">
          <article className="stat"><span className="stat-label"><Icon name="home" size={15} />Unidades</span><strong>{stats?.unidades ?? '—'}</strong></article>
          <article className="stat"><span className="stat-label"><Icon name="box" size={15} />Fornecedores</span><strong>{stats?.fornecedores ?? '—'}</strong></article>
          <article className="stat"><span className="stat-label"><Icon name="layers" size={15} />Materiais</span><strong>{stats?.materiais ?? '—'}</strong></article>
          <article className="stat"><span className="stat-label"><Icon name="shield" size={15} />Garantias</span><strong>{stats?.garantias ?? '—'}</strong></article>
        </div>
        <div className="grid grid-2">
          <section className="panel">
            <h2>Chamados recentes</h2>
            {!chamados.length ? <Empty text="Nenhum chamado ainda." /> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Nº</th><th>Título</th><th>Status</th></tr></thead>
                  <tbody>
                    {chamados.map((c) => (
                      <tr key={c.id}>
                        <td><Link to={`/chamados/${c.id}`}>{`ID: ${c.numero_registro}`}</Link></td>
                        <td>{c.titulo}</td>
                        <td><Badge value={c.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="panel">
            <h2>Manutenções</h2>
            {!manutencoes.length ? <Empty text="Sem manutenções cadastradas." /> : (
              <div className="stack">
                {manutencoes.map((m) => (
                  <div key={m.id} className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <strong>{m.sistema}</strong>
                      <div className="muted">{formatDate(m.proxima_execucao)}</div>
                    </div>
                    <Badge value={maintenanceTone(m)} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
