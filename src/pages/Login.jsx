import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { supabaseConfigured } from '../lib/supabase';
import { loadBranding, rememberBrandCondo, rememberedBrandCondo } from '../lib/branding';
import { Alert, Btn, Field } from '../components/ui';

export function LoginPage() {
  const { session, signIn, selectCondo } = useSession();
  const navigate = useNavigate();
  const { condoId: condoParam } = useParams();
  const [searchParams] = useSearchParams();
  const targetCondoId = condoParam || searchParams.get('condo') || rememberedBrandCondo();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState({ nome: '', logo: '', login: '', capa: '' });

  useEffect(() => {
    if (!targetCondoId) return;
    rememberBrandCondo(targetCondoId);
    loadBranding(targetCondoId).then(setBrand);
  }, [targetCondoId]);

  useEffect(() => {
    const title = brand.nome ? `${brand.nome} · Entrar` : 'CCA Unificado · Entrar';
    document.title = title;
    return () => {
      document.title = 'CCA Unificado';
    };
  }, [brand.nome]);

  if (session && !targetCondoId) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
      if (targetCondoId) selectCondo(targetCondoId);
    } catch (err) {
      setError(err.message || 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  function enterCondo() {
    if (targetCondoId) selectCondo(targetCondoId);
    navigate('/painel');
  }

  const nome = brand.nome || 'CCA Unificado';
  const hero = brand.login || brand.capa;
  const hasCondo = Boolean(brand.nome || brand.logo);

  return (
    <div className={`auth-screen${hero ? ' has-hero' : ''}`}>
      <aside
        className="auth-hero"
        style={hero ? { backgroundImage: `url(${hero})` } : undefined}
      >
        <div className="auth-hero-shade" />
        <div className="auth-hero-brand">
          <div className={`auth-logo-wrap${brand.logo ? '' : ' placeholder'}`}>
            {brand.logo ? <img src={brand.logo} alt={nome} /> : <span className="mark" aria-hidden="true" />}
          </div>
          <p className="auth-kicker">{hasCondo ? 'Portal do condomínio' : 'Assistência técnica condominial'}</p>
          <h1>{nome}</h1>
          <p className="auth-hero-copy">Acesso seguro para moradores, administração e gestão técnica.</p>
        </div>
      </aside>

      <main className="auth-panel">
        <div className="auth-card auth-card-login">
          <div className="auth-card-logo">
            {brand.logo ? <img src={brand.logo} alt="" /> : <span className="mark" aria-hidden="true" />}
          </div>
          <p className="auth-kicker">{hasCondo ? nome : 'CCA Unificado'}</p>
          <h2>Entrar</h2>
          <p className="muted">Use o e-mail e a senha da sua conta neste condomínio.</p>
          {!supabaseConfigured ? (
            <Alert error="Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env" />
          ) : null}
          <Alert error={error} />
          {session ? (
            <div className="stack">
              <p className="muted">Você já está autenticado. Esta é a tela de login de {nome}.</p>
              <Btn icon="building" onClick={enterCondo}>
                Entrar neste condomínio
              </Btn>
            </div>
          ) : (
            <form className="stack" onSubmit={onSubmit}>
              <Field label="E-mail">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </Field>
              <Field label="Senha">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </Field>
              <Btn type="submit" icon="lock" disabled={busy || !supabaseConfigured}>
                {busy ? 'Entrando…' : 'Acessar'}
              </Btn>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
