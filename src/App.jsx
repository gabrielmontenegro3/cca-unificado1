import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './lib/session';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { SecoesPage } from './pages/Secoes';
import { DocumentosPage, ContatosPage } from './pages/Conteudo';
import { BoletinsPage } from './pages/Boletins';
import { CatalogDetail, CatalogList } from './pages/Catalogo';
import { ManutencaoPage } from './pages/Manutencao';
import { ChamadoDetalhePage, ChamadoNovoPage, ChamadosPage } from './pages/Chamados';
import { LaudoDetalhePage, LaudoNovoPage, LaudosPage } from './pages/Laudos';
import { UsuariosPage } from './pages/Admin';
import { CondominiosPortal } from './pages/Condominios';
import { ConvitePage } from './pages/Convite';
import { SuportePage } from './pages/Suporte';
import { can } from './lib/permissions';
import { Alert, Page } from './components/ui';

function HomeRedirect() {
  const { cargoTipo, isGestaoTecnica } = useSession();
  if (isGestaoTecnica) return <DashboardPage />;
  if (!can(cargoTipo, 'dashboard_ops')) return <Navigate to="/chamados" replace />;
  return <DashboardPage />;
}

function Guard({ children }) {
  const { configured, loading, session, membership, isGestaoTecnica, error } = useSession();
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
  if (!session) return <Navigate to="/login" replace />;
  if (!membership && !isGestaoTecnica) {
    return (
      <Page title="Sem condomínio">
        <Alert error={error || 'Seu usuário ainda não está vinculado a um condomínio. Peça à Gestão Técnica para criar o empreendimento e o vínculo.'} />
      </Page>
    );
  }
  return children;
}

function AppLayout() {
  const { isGestaoTecnica } = useSession();
  const { pathname } = useLocation();
  if (isGestaoTecnica && (pathname === '/' || pathname.startsWith('/condominios'))) {
    return <CondominiosPortal />;
  }
  if (isGestaoTecnica && pathname.startsWith('/suporte')) {
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
        <Route path="painel" element={<DashboardPage />} />
        <Route path="visao-geral" element={<SecoesPage table="visao_geral_secoes" title="Visão geral" lead="Página inicial institucional do condomínio." cover="visao" />} />
        <Route path="empreendimento" element={<SecoesPage table="empreendimento_secoes" title="Sobre o empreendimento" lead="Seções livres de título e texto, mais documentos." cover="visao" extra={<p className="muted">Documentos ficam na tela específica.</p>} />} />
        <Route path="sobre-nos" element={<SecoesPage table="sobre_nos" title="Sobre nós" lead="Blocos institucionais." />} />
        <Route path="documentos" element={<DocumentosPage />} />
        <Route path="boletins" element={<BoletinsPage />} />
        <Route path="contatos" element={<ContatosPage />} />
        <Route path="fornecedores" element={<CatalogList table="fornecedores" />} />
        <Route path="fornecedores/:id" element={<CatalogDetail table="fornecedores" />} />
        <Route path="materiais" element={<CatalogList table="materiais" />} />
        <Route path="materiais/:id" element={<CatalogDetail table="materiais" />} />
        <Route path="locais" element={<CatalogList table="locais" />} />
        <Route path="locais/:id" element={<CatalogDetail table="locais" />} />
        <Route path="garantias" element={<CatalogList table="garantias" />} />
        <Route path="garantias/:id" element={<CatalogDetail table="garantias" />} />
        <Route path="manutencao" element={<ManutencaoPage />} />
        <Route path="chamados" element={<ChamadosPage />} />
        <Route path="chamados/novo" element={<ChamadoNovoPage />} />
        <Route path="chamados/:id" element={<ChamadoDetalhePage />} />
        <Route path="laudos" element={<LaudosPage />} />
        <Route path="laudos/novo" element={<LaudoNovoPage />} />
        <Route path="laudos/:id" element={<LaudoDetalhePage />} />
        <Route path="condominios" element={<CondominiosPortal />} />
        <Route path="suporte" element={<SuportePage />} />
        <Route path="suporte/:id" element={<SuportePage />} />
        <Route path="usuarios" element={<UsuariosPage />} />
        <Route path="unidades" element={<Navigate to="/" replace />} />
        <Route path="perfil" element={<Navigate to="/chamados" replace />} />
      </Route>
    </Routes>
  );
}
