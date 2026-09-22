import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { supabaseConfigured } from '../lib/supabase';
import {
  loadBranding,
  loadBrandingConstrutora,
  rememberBrandCondo,
  isCondoUuid,
  resolverLoginPortal,
  slugCondominio,
  ehHostPrincipal,
} from '../lib/branding';
import { APP_LOGO, Alert, Btn, Field } from '../components/ui';
import { Icon } from '../components/icons';

export function LoginPage() {
  const {
    session,
    signIn,
    signOut,
    selectCondo,
    isGestaoTecnica,
    isConstrutoraOrg,
    construtora,
    memberships,
    profile,
    loading,
  } = useSession();
  const navigate = useNavigate();
  const { condoId: condoParam } = useParams();
  const [searchParams] = useSearchParams();
  const portalRef = condoParam || searchParams.get('condo') || '';
  const [target, setTarget] = useState(() => (
    isCondoUuid(portalRef) ? { tipo: '', id: portalRef } : { tipo: '', id: '' }
  ));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState({ nome: '', logo: '', login: '', capa: '' });

  const targetCondoId = target.tipo === 'condominio' ? target.id : '';
  const targetConstrutoraId = target.tipo === 'construtora' ? target.id : '';

  useEffect(() => {
    sessionStorage.removeItem('cca.logoutTo');
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      async function apply(ref) {
        const portal = await resolverLoginPortal(ref);
        if (!live) return Boolean(portal?.id);
        if (portal?.id) {
          setTarget({ tipo: portal.tipo, id: portal.id });
          setError('');
          return true;
        }
        return false;
      }

      if (portalRef) {
        const ok = await apply(portalRef);
        if (!ok && live) {
          setTarget({ tipo: '', id: '' });
          setError('Não encontramos este portal.');
        }
        return;
      }
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      if (host && !ehHostPrincipal(host)) {
        const ok = await apply(host);
        if (ok) return;
      }
      if (live) setTarget({ tipo: '', id: '' });
    })();
    return () => {
      live = false;
    };
  }, [portalRef]);

  useEffect(() => {
    if (!target.id || !target.tipo) return;
    if (target.tipo === 'condominio') {
      rememberBrandCondo(target.id);
      loadBranding(target.id).then(setBrand);
      return;
    }
    loadBrandingConstrutora(target.id).then(setBrand);
  }, [target.id, target.tipo]);

  useEffect(() => {
    if (!isCondoUuid(condoParam) || !brand.nome) return;
    const slug = slugCondominio(brand.nome);
    if (slug) navigate(`/login/${slug}`, { replace: true });
  }, [condoParam, brand.nome, navigate]);

  useEffect(() => {
    const branded = brand.nome && target.id;
    document.title = branded ? `${brand.nome} · Entrar` : 'CCA Unificado · Entrar';
    return () => {
      document.title = 'CCA Unificado';
    };
  }, [brand.nome, target.id]);

  const isPortalLogin = Boolean(portalRef || target.id);
  const isConstrutoraLogin = target.tipo === 'construtora';
  const construtoraAtualId = construtora?.id || profile?.construtora_id || '';
  const pertenceAoPortal = isGestaoTecnica
    || (isConstrutoraLogin
      ? Boolean(construtoraAtualId) && String(construtoraAtualId).toLowerCase() === String(targetConstrutoraId).toLowerCase()
      : memberships.some((item) => item.condominio_id === targetCondoId) || (
        Boolean(construtoraAtualId) && memberships.some((item) => item.condominio_id === targetCondoId)
      ));

  if (session && !loading && !isPortalLogin) {
    return <Navigate to={isGestaoTecnica || isConstrutoraOrg ? '/' : '/visao-geral'} replace />;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email, password, {
        condominioId: targetCondoId || '',
        construtoraId: targetConstrutoraId || '',
      });
      navigate(targetConstrutoraId ? '/' : (targetCondoId ? '/visao-geral' : '/'), { replace: true });
    } catch (err) {
      setError(err.message || 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  function enterPortal() {
    if (!pertenceAoPortal) {
      setError(isConstrutoraLogin
        ? 'Sua conta não tem acesso a esta construtora.'
        : 'Sua conta não tem acesso a este condomínio.');
      return;
    }
    if (isConstrutoraLogin) {
      navigate('/');
      return;
    }
    selectCondo(targetCondoId);
    navigate(isConstrutoraOrg ? '/governanca-tecnica' : '/visao-geral');
  }

  const nome = isPortalLogin
    ? brand.nome || (isConstrutoraLogin ? 'Construtora' : 'Condomínio')
    : 'CCA Unificado';
  const logoSrc = isPortalLogin ? brand.logo : APP_LOGO;
  const kicker = isConstrutoraLogin
    ? 'Portal da construtora'
    : (isPortalLogin ? 'Portal do condomínio' : 'CCA Unificado');

  return (
    <div className={`auth-screen${isConstrutoraLogin ? ' is-construtora' : isPortalLogin ? ' is-condo' : ' is-cca'}`}>
      <main className="auth-panel">
        <div className="auth-card-login">
          {isConstrutoraLogin ? (
            <div className="auth-card-logos">
              <div className="auth-card-logo">
                <img src={APP_LOGO} alt="CCA" />
              </div>
              <span className="auth-logos-bar" aria-hidden="true" />
              <div className="auth-card-logo">
                {brand.logo ? <img src={brand.logo} alt={nome} /> : <span className="mark" aria-hidden="true" />}
              </div>
            </div>
          ) : (
            <div className={`auth-card-logo${isPortalLogin ? '' : ' app-brand'}`}>
              {logoSrc ? <img src={logoSrc} alt={nome} /> : <span className="mark" aria-hidden="true" />}
            </div>
          )}
          <p className="auth-kicker">{kicker}</p>
          <h1>{nome}</h1>
          {!supabaseConfigured ? (
            <Alert error="Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env" />
          ) : null}
          <Alert error={error} />
          {session ? (
            loading || (isPortalLogin && !target.tipo) ? (
              <p className="muted">Verificando acesso…</p>
            ) : (
            <div className="stack">
              {pertenceAoPortal ? (
                <>
                  <p className="muted">Você já está autenticado. Esta é a tela de login de {nome}.</p>
                  <Btn icon="building" onClick={enterPortal}>
                    {isConstrutoraLogin ? 'Entrar neste portal' : 'Entrar neste condomínio'}
                  </Btn>
                </>
              ) : (
                <>
                  <Alert error={isConstrutoraLogin
                    ? 'Sua conta não tem acesso a esta construtora.'
                    : 'Sua conta não tem acesso a este condomínio.'}
                  />
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
            )
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
              <Btn type="submit" icon="lock" disabled={busy || !supabaseConfigured || (Boolean(portalRef) && !target.id)}>
                {busy ? 'Entrando…' : 'Acessar'}
              </Btn>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
