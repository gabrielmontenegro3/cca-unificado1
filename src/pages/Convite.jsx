import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { CARGO_LABEL } from '../lib/permissions';
import { aceitarConvite, aceitarConviteCadastro, criarLoginSemTrocarSessao, salvarFotoUsuario, verConvite } from '../lib/api';
import { useSession } from '../lib/session';
import {
  loadBranding,
  loadBrandingConstrutora,
  loginPathDaConstrutora,
  loginPathDoCondominio,
  rememberBrandCondo,
} from '../lib/branding';
import { Alert, BrandLogo, Btn, Field } from '../components/ui';
import { FotoPicker } from '../components/UsuarioCampos';

export function ConvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { session, signOut } = useSession();
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ nome: '', email: '', password: '' });
  const [foto, setFoto] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [criadoOk, setCriadoOk] = useState(false);
  const [brand, setBrand] = useState({ nome: '', logo: '', login: '' });

  const isConstrutora = Boolean(info?.construtora_id);
  const isGestao = Boolean(info?.gestao_tecnica);
  const pedeFoto = isConstrutora || isGestao;
  const loginTo = isGestao
    ? '/login'
    : isConstrutora
      ? loginPathDaConstrutora(info?.construtora || brand.nome, info?.construtora_id)
      : loginPathDoCondominio(info?.condominio || brand.nome, info?.condominio_id);

  useEffect(() => {
    if (!token || !supabaseConfigured) return;
    verConvite(token)
      .then((data) => {
        setInfo(data);
        if (data?.email) setForm((prev) => ({ ...prev, email: data.email }));
        if (data?.construtora_id) {
          loadBrandingConstrutora(data.construtora_id).then(setBrand);
          return;
        }
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
      if (foto) {
        try {
          await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
          await salvarFotoUsuario(userId, foto);
        } catch {
          /* foto opcional no convite */
        }
      }
      setCriadoOk(true);
      try {
        await signOut({ to: loginTo });
      } catch {
        /* ok */
      }
    } catch (err) {
      setError(err.message || 'Não foi possível criar a conta.');
    } finally {
      setBusy(false);
    }
  }

  async function onAcceptExisting() {
    setBusy(true);
    setError('');
    try {
      await aceitarConvite(token);
      if (foto && session?.user?.id) {
        try {
          await salvarFotoUsuario(session.user.id, foto);
        } catch {
          /* foto opcional */
        }
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Não foi possível aceitar o convite.');
    } finally {
      setBusy(false);
    }
  }

  const blocked = info && (info.ok === false || info.expirado || info.usado);
  const titulo = isGestao
    ? 'Convite para Gestão Técnica'
    : isConstrutora
      ? 'Convite para a construtora'
      : 'Convite para o condomínio';
  const destinoNome = isGestao
    ? 'CCA Unificado'
    : (brand.nome || info?.construtora || info?.condominio || 'CCA Unificado');
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ width: 'min(460px, 100%)' }}>
        <div className="brand">
          <BrandLogo src={brand.logo} name={destinoNome} />
          <span>
            <strong>{destinoNome}</strong>
            <small>{titulo}</small>
          </span>
        </div>

        {criadoOk ? (
          <div className="stack convite-success">
            <h1>Conta pronta</h1>
            <Alert ok="Cadastro concluído com sucesso. Agora entre com seu e-mail e senha." />
            <p className="muted">
              {destinoNome}
              {info?.cargo && !isGestao ? ` · ${CARGO_LABEL[info.cargo] || info.cargo}` : ''}
            </p>
            <Btn to={loginTo} icon="lock">
              Ir para a tela de Login
            </Btn>
          </div>
        ) : (
          <>
            <h1>Criar acesso</h1>
            {info?.ok ? (
              <p className="muted">
                {isGestao
                  ? 'Gestão Técnica'
                  : [info.construtora || info.condominio, CARGO_LABEL[info.cargo] || info.cargo, info.unidade ? `Unidade ${info.unidade}` : '']
                    .filter(Boolean)
                    .join(' · ')}
              </p>
            ) : null}
            <Alert error={error || (info && info.ok === false ? info.erro : '')} />
            {info?.expirado ? <Alert error="Este convite expirou. Peça um novo à Gestão Técnica." /> : null}
            {info?.usado ? <Alert error="Este convite já foi usado." /> : null}

            {!blocked && info?.ok ? (
              session ? (
                <div className="stack">
                  <p>Você já está autenticado como {session.user.email}.</p>
                  {pedeFoto ? <FotoPicker file={foto} onChange={setFoto} hint="Opcional. Você pode enviar a foto agora." /> : null}
                  <Btn icon="check" disabled={busy} onClick={onAcceptExisting}>
                    {busy ? 'Vinculando…' : 'Aceitar convite'}
                  </Btn>
                </div>
              ) : (
                <form className="stack" onSubmit={onCreate}>
                  {pedeFoto ? <FotoPicker file={foto} onChange={setFoto} hint="Opcional. Aparece no seu perfil." /> : null}
                  <Field label="Nome">
                    <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required disabled={busy} />
                  </Field>
                  <Field label="E-mail">
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required disabled={busy} />
                  </Field>
                  <Field label="Senha">
                    <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} required disabled={busy} />
                  </Field>
                  <Btn type="submit" icon="user" disabled={busy}>
                    {busy ? 'Criando…' : 'Criar conta'}
                  </Btn>
                </form>
              )
            ) : null}
            <p className="hint" style={{ marginTop: 16 }}>
              <Link to={loginTo}>Ir para o login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
