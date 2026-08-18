import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabaseConfigured } from '../lib/supabase';
import { CARGO_LABEL } from '../lib/permissions';
import { aceitarConvite, aceitarConviteCadastro, criarLoginSemTrocarSessao, verConvite } from '../lib/api';
import { useSession } from '../lib/session';
import { loadBranding, rememberBrandCondo } from '../lib/branding';
import { Alert, BrandLogo, Btn, Field } from '../components/ui';

export function ConvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { session, signIn } = useSession();
  const [info, setInfo] = useState(null);
  const [mode, setMode] = useState('criar');
  const [form, setForm] = useState({ nome: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState({ nome: '', logo: '', login: '' });

  useEffect(() => {
    if (!token || !supabaseConfigured) return;
    verConvite(token)
      .then((data) => {
        setInfo(data);
        if (data?.email) setForm((prev) => ({ ...prev, email: data.email }));
        if (data?.condominio_id) {
          rememberBrandCondo(data.condominio_id);
          loadBranding(data.condominio_id).then(setBrand);
        }
      })
      .catch((err) => setError(err.message));
  }, [token]);

  async function onCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const userId = await criarLoginSemTrocarSessao({
        email: form.email,
        password: form.password,
        nome: form.nome,
        conviteToken: token,
      });
      if (!userId) throw new Error('Conta criada, mas o id do usuário não veio. Tente entrar e abrir o link de novo.');
      await aceitarConviteCadastro(token, userId);
      try {
        await signIn(form.email, form.password);
        navigate('/', { replace: true });
      } catch {
        setError('Conta criada e vinculada. Confirme o e-mail se o sistema pedir e entre em Login.');
      }
    } catch (err) {
      setError(err.message || 'Não foi possível criar a conta.');
    } finally {
      setBusy(false);
    }
  }

  async function onLogin(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(form.email, form.password);
      await aceitarConvite(token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  async function onAcceptExisting() {
    setBusy(true);
    setError('');
    try {
      await aceitarConvite(token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Não foi possível aceitar o convite.');
    } finally {
      setBusy(false);
    }
  }

  const blocked = info && (info.ok === false || info.expirado || info.usado);

  return (
    <div className={`auth-wrap${brand.login ? ' auth-wrap-photo' : ''}`} style={brand.login ? { backgroundImage: `url(${brand.login})` } : undefined}>
      <div className="auth-card" style={{ width: 'min(460px, 100%)' }}>
        <div className="brand">
          <BrandLogo src={brand.logo} name={brand.nome || info?.condominio} />
          <span>
            <strong>{brand.nome || info?.condominio || 'CCA Unificado'}</strong>
            <small>Convite para o condomínio</small>
          </span>
        </div>
        <h1>Criar acesso</h1>
        {info?.ok ? (
          <p className="muted">
            {info.condominio} · {CARGO_LABEL[info.cargo] || info.cargo}
            {info.unidade ? ` · Unidade ${info.unidade}` : ''}
          </p>
        ) : null}
        <Alert error={error || (info && info.ok === false ? info.erro : '')} />
        {info?.expirado ? <Alert error="Este convite expirou. Peça um novo à Gestão Técnica." /> : null}
        {info?.usado ? <Alert error="Este convite já foi usado." /> : null}

        {!blocked && info?.ok ? (
          session ? (
            <div className="stack">
              <p>Você já está autenticado como {session.user.email}.</p>
              <Btn icon="check" disabled={busy} onClick={onAcceptExisting}>
                {busy ? 'Vinculando…' : 'Aceitar convite'}
              </Btn>
            </div>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <button className={mode === 'criar' ? 'btn' : 'btn-ghost'} type="button" onClick={() => setMode('criar')}>
                  Criar conta
                </button>
                <button className={mode === 'entrar' ? 'btn' : 'btn-ghost'} type="button" onClick={() => setMode('entrar')}>
                  Já tenho login
                </button>
              </div>
              {mode === 'criar' ? (
                <form className="stack" onSubmit={onCreate}>
                  <Field label="Nome">
                    <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
                  </Field>
                  <Field label="E-mail">
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                  </Field>
                  <Field label="Senha">
                    <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} required />
                  </Field>
                  <Btn type="submit" icon="user" disabled={busy}>
                    {busy ? 'Criando…' : 'Criar e entrar'}
                  </Btn>
                </form>
              ) : (
                <form className="stack" onSubmit={onLogin}>
                  <Field label="E-mail">
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                  </Field>
                  <Field label="Senha">
                    <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                  </Field>
                  <Btn type="submit" icon="lock" disabled={busy}>
                    {busy ? 'Entrando…' : 'Entrar e aceitar'}
                  </Btn>
                </form>
              )}
            </>
          )
        ) : null}
        <p className="hint" style={{ marginTop: 16 }}>
          <Link to={info?.condominio_id ? `/login/${info.condominio_id}` : '/login'}>Ir para o login</Link>
        </p>
      </div>
    </div>
  );
}
