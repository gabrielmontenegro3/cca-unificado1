import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { supabaseConfigured } from '../lib/supabase';
import { loadBranding, rememberBrandCondo, isCondoUuid, resolverLoginCondominio, slugCondominio, ehHostPrincipal } from '../lib/branding';
import { APP_LOGO, Alert, Btn, Field } from '../components/ui';
import { Icon } from '../components/icons';

export function LoginPage() {
  const { session, signIn, signOut, selectCondo, isGestaoTecnica, memberships, loading } = useSession();
  const navigate = useNavigate();
  const { condoId: condoParam } = useParams();
  const [searchParams] = useSearchParams();
  const condoRef = condoParam || searchParams.get('condo') || '';
  const [targetCondoId, setTargetCondoId] = useState(() => (isCondoUuid(condoRef) ? condoRef : ''));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState({ nome: '', logo: '', login: '', capa: '' });

  useEffect(() => {
    sessionStorage.removeItem('cca.logoutTo');
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      if (condoRef) {
        const id = await resolverLoginCondominio(condoRef);
        if (!live) return;
        if (id) {
          setTargetCondoId(id);
          setError('');
          return;
        }
        setTargetCondoId('');
        setError('Não encontramos este condomínio.');
        return;
      }
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      if (host && !ehHostPrincipal(host)) {
        const id = await resolverLoginCondominio(host);
        if (!live) return;
        if (id) {
          setTargetCondoId(id);
          return;
        }
      }
      if (live) setTargetCondoId('');
    })();
    return () => {
      live = false;
    };
  }, [condoRef]);

  useEffect(() => {
    if (!targetCondoId) return;
    rememberBrandCondo(targetCondoId);
    loadBranding(targetCondoId).then(setBrand);
  }, [targetCondoId]);

  useEffect(() => {
    if (!isCondoUuid(condoParam) || !brand.nome) return;
    const slug = slugCondominio(brand.nome);
    if (slug) navigate(`/login/${slug}`, { replace: true });
  }, [condoParam, brand.nome, navigate]);

  useEffect(() => {
    const title = brand.nome && targetCondoId ? `${brand.nome} · Entrar` : 'CCA Unificado · Entrar';
    document.title = title;
    return () => {
      document.title = 'CCA Unificado';
    };
  }, [brand.nome, targetCondoId]);

  const isCondoLogin = Boolean(condoRef || targetCondoId);
  const pertenceAoCondo = isGestaoTecnica || memberships.some((item) => item.condominio_id === targetCondoId);

  if (session && !loading && !isCondoLogin) {
    return <Navigate to={isGestaoTecnica ? '/' : '/visao-geral'} replace />;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email, password, { condominioId: targetCondoId || '' });
      navigate(targetCondoId ? '/visao-geral' : '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  function enterCondo() {
    if (!pertenceAoCondo) {
      setError('Sua conta não tem acesso a este condomínio.');
      return;
    }
    selectCondo(targetCondoId);
    navigate('/visao-geral');
  }

  const nome = isCondoLogin ? brand.nome || 'Condomínio' : 'CCA Unificado';
  const logoSrc = isCondoLogin ? brand.logo : APP_LOGO;
  const kicker = isCondoLogin ? 'Portal do condomínio' : 'Gestão Técnica';

  return (
    <div className={`auth-screen${isCondoLogin ? ' is-condo' : ' is-cca'}`}>
      <main className="auth-panel">
        <div className="auth-card-login">
          <div className={`auth-card-logo${isCondoLogin ? '' : ' app-brand'}`}>
            {logoSrc ? <img src={logoSrc} alt={nome} /> : <span className="mark" aria-hidden="true" />}
          </div>
          <p className="auth-kicker">{kicker}</p>
          <h1>{nome}</h1>
          {!supabaseConfigured ? (
            <Alert error="Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env" />
          ) : null}
          <Alert error={error} />
          {session ? (
            <div className="stack">
              {pertenceAoCondo ? (
                <>
                  <p className="muted">Você já está autenticado. Esta é a tela de login de {nome}.</p>
                  <Btn icon="building" onClick={enterCondo}>
                    Entrar neste condomínio
                  </Btn>
                </>
              ) : (
                <>
                  <Alert error="Sua conta não tem acesso a este condomínio." />
                  <Btn
                    variant="ghost"
                    icon="logout"
                    onClick={async () => {
                      await signOut({ to: window.location.pathname });
                    }}
                  >
                    Sair e usar outra conta
                  </Btn>
                </>
              )}
            </div>
          ) : (
            <form className="stack" onSubmit={onSubmit}>
              <Field label="E-mail">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </Field>
              <Field label="Senha">
                <div className="password-field">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
                  </button>
                </div>
              </Field>
              <Btn type="submit" icon="lock" disabled={busy || !supabaseConfigured || (Boolean(condoRef) && !targetCondoId)}>
                {busy ? 'Entrando…' : 'Acessar'}
              </Btn>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
