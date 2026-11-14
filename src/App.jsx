import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './lib/session';
import { ehCargoAdministracao, ehCargoConstrutora } from './lib/permissions';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/Login';
import { SecoesPage } from './pages/Secoes';
import { DocumentosPage, ContatosPage } from './pages/Conteudo';
import { BoletinsPage } from './pages/Boletins';
import { CatalogDetail, CatalogList } from './pages/Catalogo';
import { ManutencaoPage } from './pages/Manutencao';
import { MateriaisPage } from './pages/Materiais';
import { RelatorioManutencaoPage } from './pages/RelatorioManutencao';
import { ChamadoDetalhePage, ChamadoNovoPage, ChamadosPage } from './pages/Chamados';
import { ChamadoRastreabilidadePage, RastreabilidadeListaPage } from './pages/ChamadoRastreabilidade';
import { RelatorioPage } from './pages/Relatorio';
import { AgendarVisitaPage } from './pages/AgendarVisita';
import { LaudoDetalhePage, LaudoNovoPage, LaudosPage } from './pages/Laudos';
import { UsuariosPage } from './pages/Admin';
import { CondominiosPortal } from './pages/Condominios';
import { ConstrutorasPortal, ConstrutoraPortal } from './pages/Construtoras';
import { ConstrutoraCondoPage } from './pages/ConstrutoraCondo';
import { ConvitePage } from './pages/Convite';
import { SuportePage } from './pages/Suporte';
import { LaudosGlobaisPage } from './pages/LaudosGlobais';
import { GestaoTecnicaUsuariosPage } from './pages/GestaoTecnicaUsuarios';
import { ConfiguracoesPage, NotificacoesPage, OnboardingPreferencias } from './pages/Sistema';
import { GovernancaTecnicaPage } from './pages/GovernancaTecnica';
import { RecebimentoPage } from './pages/Recebimento';
import { RecebimentoConstrutoraPage } from './pages/RecebimentoConstrutora';
import { ManualUsoPage } from './pages/ManualUso';
import { TipoAptoPage } from './pages/TipoApto';
import { ConfigCondominioPage, ConfigConstrutoraPage } from './pages/ConfiguracaoGeral';
import { ConstrutoraRelatoriosPage } from './pages/ConstrutoraRelatorios';
import { ConstrutoraIndicativosPage } from './pages/ConstrutoraIndicativos';
import { Alert, Page } from './components/ui';

function HomeRedirect() {
  const { cargoTipo } = useSession();
  if (ehCargoConstrutora(cargoTipo)) return <Navigate to="/governanca-tecnica" replace />;
  return <Navigate to="/visao-geral" replace />;
}

function VisaoGeralRoute() {
  return <SecoesPage table="visao_geral_secoes" title="Visão geral" cover="visao" hero />;
}

function rotaSistemaCondominio(pathname) {
  if (pathname === '/chamados/novo' || pathname.startsWith('/chamados/novo/')) return false;
  const prefixos = [
    '/visao-geral',
    '/documentos',
    '/boletins',
    '/contatos',
    '/meu-imovel',
    '/recebimento',
    '/manual-uso',
    '/tipo-apto',
    '/meu-apartamento',
    '/sobre-nos',
    '/manutencao',
    '/fornecedores',
    '/materiais',
    '/locais',
    '/garantias',
    '/chamados',
  ];
  return prefixos.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`));
}

function Guard({ children }) {
  const { configured, loading, session, membership, cargoTipo, isGestaoTecnica, isAdminSistema, isConstrutoraOrg, condoId, error, needsPreferencias } = useSession();
  const { pathname } = useLocation();
  if (!configured) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Alert error="Crie um arquivo .env com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY." />
        </div>
      </div>
    );
  }
  if (loading) return <div className="auth-wrap">Carregando…</div>;
  if (!session) {
    const destino = sessionStorage.getItem('cca.logoutTo') || '/login';
    return <Navigate to={destino} replace />;
  }
  // Primeiro acesso (GT ou usuário do condomínio): obrigatório definir visualização
  if (needsPreferencias) {
    return <OnboardingPreferencias />;
  }
  if (!isGestaoTecnica && (
    pathname.startsWith('/construtoras')
    || (pathname.startsWith('/condominios') && !isConstrutoraOrg)
    || pathname.startsWith('/suporte')
    || (pathname.startsWith('/laudos-globais') && !isConstrutoraOrg)
    || pathname.startsWith('/gestao-tecnica')
    || pathname.startsWith('/rastreabilidade')
    || pathname.startsWith('/agendar-visita')
    || pathname.startsWith('/relatorio')
    || /\/chamados\/[^/]+\/rastreabilidade/.test(pathname)
  )) {
    return <Navigate to="/" replace />;
  }
  if ((pathname.startsWith('/gestao-tecnica') || pathname.startsWith('/admin-geral')) && !isAdminSistema) {
    return <Navigate to="/" replace />;
  }
  if (String(cargoTipo || '').toLowerCase().trim() === 'morador' && (pathname === '/manutencao' || pathname.startsWith('/manutencao/'))) {
    return <Navigate to="/visao-geral" replace />;
  }
  if (ehCargoAdministracao(cargoTipo) && (pathname.startsWith('/meu-apartamento') || pathname.startsWith('/tipo-apto'))) {
    return <Navigate to="/visao-geral" replace />;
  }
  if (ehCargoConstrutora(cargoTipo)) {
    const laudoMatch = pathname.match(/^\/laudos\/([^/]+)$/);
    if (isConstrutoraOrg && pathname.startsWith('/governanca-tecnica')) {
      const id = pathname.split('/')[2];
      if (condoId) {
        return <Navigate to={id ? `/construtora/${condoId}/governanca/${id}` : `/construtora/${condoId}`} replace />;
      }
      return <Navigate to="/" replace />;
    }
    if (laudoMatch && laudoMatch[1] !== 'novo') {
      return <Navigate to={`/governanca-tecnica/${laudoMatch[1]}`} replace />;
    }
    const permitida = isConstrutoraOrg ? (
      pathname === '/'
      || pathname === '/painel'
      || pathname.startsWith('/construtora')
      || pathname.startsWith('/laudos-globais')
      || pathname.startsWith('/condominios')
      || pathname.startsWith('/configuracoes')
      || pathname.startsWith('/notificacoes')
      || rotaSistemaCondominio(pathname)
    ) : (
      pathname === '/'
      || pathname === '/painel'
      || pathname.startsWith('/governanca-tecnica')
      || pathname.startsWith('/configuracoes')
      || pathname.startsWith('/notificacoes')
      || rotaSistemaCondominio(pathname)
    );
    if (!permitida) {
      return <Navigate to={isConstrutoraOrg ? '/' : '/governanca-tecnica'} replace />;
    }
  }
  if (!isGestaoTecnica && !isConstrutoraOrg && !membership) {
    return (
      <Page title="Sem condomínio">
        <Alert error={error || 'Seu usuário ainda não está vinculado a um condomínio. Peça à Gestão Técnica para criar o empreendimento e o vínculo.'} />
      </Page>
    );
  }
  return children;
}

function AppLayout() {
  const { isGestaoTecnica, isConstrutoraOrg, condoId } = useSession();
  const { pathname } = useLocation();
  if (isGestaoTecnica && (pathname === '/' || pathname.startsWith('/condominios'))) {
    return <CondominiosPortal />;
  }
  if (isGestaoTecnica && pathname.startsWith('/construtoras')) {
    return <ConstrutorasPortal />;
  }
  if (isConstrutoraOrg && (pathname === '/' || pathname.startsWith('/condominios'))) {
    return <ConstrutoraPortal />;
  }
  if (isConstrutoraOrg && pathname.startsWith('/construtora')) {
    return <Outlet />;
  }
  if (
    (isGestaoTecnica || isConstrutoraOrg)
    && (
      pathname.startsWith('/laudos-globais')
      || (isGestaoTecnica && (
        pathname.startsWith('/suporte')
        || pathname.startsWith('/gestao-tecnica')
        || pathname.startsWith('/admin-geral')
      ))
      || (pathname.startsWith('/notificacoes') && !condoId)
      || (pathname.startsWith('/configuracoes') && !condoId)
    )
  ) {
    return <Outlet />;
  }
  return <Shell />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/:condoId" element={<LoginPage />} />
      <Route path="/convite/:token" element={<ConvitePage />} />
      <Route
        path="/"
        element={
          <Guard>
            <AppLayout />
          </Guard>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route path="painel" element={<Navigate to="/visao-geral" replace />} />
        <Route path="visao-geral" element={<VisaoGeralRoute />} />
        <Route path="meu-imovel" element={<Navigate to="/recebimento" replace />} />
        <Route path="recebimento" element={<RecebimentoPage />} />
        <Route path="recebimento/:unidadeId" element={<RecebimentoPage />} />
        <Route path="construtora-recebimento" element={<RecebimentoConstrutoraPage />} />
        <Route path="construtora-recebimento/:registroId" element={<RecebimentoConstrutoraPage />} />
        <Route path="manual-uso" element={<ManualUsoPage />} />
        <Route path="tipo-apto" element={<Navigate to="/meu-apartamento" replace />} />
        <Route path="meu-apartamento" element={<TipoAptoPage />} />
        <Route path="empreendimento" element={<Navigate to="/visao-geral" replace />} />
        <Route path="sobre-nos" element={<SecoesPage table="sobre_nos" title="Sobre nós" lead="Blocos institucionais." />} />
        <Route path="documentos" element={<DocumentosPage />} />
        <Route path="boletins" element={<BoletinsPage />} />
        <Route path="contatos" element={<ContatosPage />} />
        {/* Fornecedores e Garantias agora fazem parte da tela Materiais. */}
        <Route path="fornecedores/*" element={<Navigate to="/materiais" replace />} />
        <Route path="materiais" element={<MateriaisPage />} />
        <Route path="materiais/:id" element={<Navigate to="/materiais" replace />} />
        <Route path="locais" element={<CatalogList table="locais" />} />
        <Route path="locais/:id" element={<CatalogDetail table="locais" />} />
        <Route path="garantias/*" element={<Navigate to="/materiais" replace />} />
        <Route path="manutencao" element={<ManutencaoPage />} />
        <Route path="manutencao/relatorio" element={<RelatorioManutencaoPage />} />
        <Route path="assistencia-tecnica" element={<ChamadosPage />} />
        <Route path="chamados" element={<ChamadosPage />} />
        <Route path="chamados/novo" element={<ChamadoNovoPage />} />
        <Route path="chamados/:id" element={<ChamadoDetalhePage />} />
        <Route path="rastreabilidade" element={<RastreabilidadeListaPage />} />
        <Route path="rastreabilidade/:id" element={<ChamadoRastreabilidadePage />} />
        <Route path="chamados/:id/rastreabilidade" element={<ChamadoRastreabilidadePage />} />
        <Route path="agendar-visita" element={<AgendarVisitaPage />} />
        <Route path="relatorio" element={<RelatorioPage />} />
        <Route path="laudos" element={<LaudosPage />} />
        <Route path="laudos/novo" element={<LaudoNovoPage />} />
        <Route path="laudos/:id" element={<LaudoDetalhePage />} />
        <Route path="governanca-tecnica" element={<GovernancaTecnicaPage />} />
        <Route path="governanca-tecnica/:id" element={<GovernancaTecnicaPage />} />
        <Route path="construtora-relatorios" element={<ConstrutoraRelatoriosPage />} />
        <Route path="construtora-indicativos" element={<ConstrutoraIndicativosPage />} />
        <Route path="construtora/:condoId" element={<ConstrutoraCondoPage />} />
        <Route path="construtora/:condoId/ocorrencias/:chamadoId" element={<ConstrutoraCondoPage />} />
        <Route path="construtora/:condoId/governanca/:laudoId" element={<ConstrutoraCondoPage />} />
        <Route path="condominios" element={<CondominiosPortal />} />
        <Route path="construtoras" element={<ConstrutorasPortal />} />
        <Route path="suporte" element={<SuportePage />} />
        <Route path="suporte/:id" element={<SuportePage />} />
        <Route path="laudos-globais" element={<LaudosGlobaisPage />} />
        <Route path="laudos-globais/:id" element={<LaudosGlobaisPage />} />
        <Route path="gestao-tecnica" element={<GestaoTecnicaUsuariosPage />} />
        <Route path="admin-geral/condominio/:id" element={<ConfigCondominioPage />} />
        <Route path="admin-geral/construtora/:id" element={<ConfigConstrutoraPage />} />
        <Route path="configuracoes" element={<ConfiguracoesPage />} />
        <Route path="notificacoes" element={<NotificacoesPage />} />
        <Route path="usuarios" element={<UsuariosPage />} />
        <Route path="unidades" element={<Navigate to="/" replace />} />
        <Route path="perfil" element={<Navigate to="/visao-geral" replace />} />
      </Route>
    </Routes>
  );
}
