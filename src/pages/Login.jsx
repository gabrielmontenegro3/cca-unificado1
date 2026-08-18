import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { supabaseConfigured } from '../lib/supabase';
import { loadBranding, rememberBrandCondo, rememberedBrandCondo } from '../lib/branding';
import { Alert, BrandLogo, Btn, Field } from '../components/ui';

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
  const [brand, setBrand] = useState({ nome: '', logo: '', login: '' });

  useEffect(() => {
    if (!targetCondoId) return;
    rememberBrandCondo(targetCondoId);
    loadBranding(targetCondoId).then(setBrand);
  }, [targetCondoId]);

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

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <BrandLogo src={brand.logo} name={nome} />
          <span>
            <strong>{nome}</strong>
            <small>{brand.nome ? 'Acesso do condomínio' : 'Assistência técnica condominial'}</small>
          </span>
        </div>
        <h1>Entrar</h1>
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
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Senha">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Btn type="submit" icon="lock" disabled={busy || !supabaseConfigured}>
              {busy ? 'Entrando…' : 'Acessar'}
            </Btn>
          </form>
        )}
      </div>
    </div>
  );
}
