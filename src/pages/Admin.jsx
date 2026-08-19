import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { CARGO_LABEL, can } from '../lib/permissions';
import { criarConvite, criarLoginSemTrocarSessao, listarConvites, vincularUsuario } from '../lib/api';
import { copiarTexto } from '../lib/parseSeed';
import { conviteUrl } from '../lib/branding';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';

const CARGOS_CONVITE = ['administrador', 'construtora', 'administracao', 'morador'];
const UNIDADE_PLACEHOLDER = 'Bloco A / Casa 12    ou    Bloco B / Apt 101';
const UNIDADE_HINT = 'Escreva no padrão: Bloco / Casa  ou  Bloco / Apartamento.';

export function UsuariosPage() {
  const { condoId, cargoTipo } = useSession();
  const [rows, setRows] = useState([]);
  const [convites, setConvites] = useState([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [createForm, setCreateForm] = useState({ nome: '', email: '', password: '', cargo: 'morador', unidadeTexto: '' });
  const [inviteForm, setInviteForm] = useState({ email: '', cargo: 'morador', unidadeTexto: '' });
  const canManage = can(cargoTipo, 'manage_users');

  async function load() {
    const { data, error: err } = await supabase
      .from('usuario_condominio')
      .select('*, usuarios(nome, email, ativo), cargos(nome, tipo)')
      .eq('condominio_id', condoId);
    if (err) setError(err.message);
    setRows(data || []);
    try {
      setConvites(await listarConvites(condoId));
    } catch (inviteErr) {
      setError(inviteErr.message || 'Não foi possível carregar os convites.');
    }
  }
  useEffect(() => { if (condoId) load(); }, [condoId]);

  function inviteUrl(token) {
    return conviteUrl(token);
  }

  async function onCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      let userId = null;
      try {
        userId = await criarLoginSemTrocarSessao({
          email: createForm.email,
          password: createForm.password,
          nome: createForm.nome,
        });
      } catch (err) {
        const msg = String(err.message || '');
        if (!/already|registered|exists|já|limitou o e-mail|rate_limit/i.test(msg)) throw err;
      }
      await vincularUsuario({
        condominioId: condoId,
        cargo: createForm.cargo,
        usuarioId: userId,
        email: createForm.email,
        unidadeTexto: createForm.cargo === 'morador' ? createForm.unidadeTexto : null,
      });
      setCreateForm({ nome: '', email: '', password: '', cargo: 'morador', unidadeTexto: '' });
      setOk('Usuário criado e vinculado a este condomínio.');
      load();
    } catch (err) {
      setError(err.message || 'Não foi possível criar o usuário.');
    } finally {
      setBusy(false);
    }
  }

  async function onInvite(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      const token = await criarConvite({
        condominioId: condoId,
        cargo: inviteForm.cargo,
        email: inviteForm.email,
        unidadeTexto: inviteForm.cargo === 'morador' ? inviteForm.unidadeTexto : null,
      });
      const url = inviteUrl(token);
      setLink(url);
      await copiarTexto(url);
      setOk('Link gerado e copiado. Envie para a pessoa criar o próprio acesso.');
      setInviteForm({ email: '', cargo: inviteForm.cargo, unidadeTexto: '' });
      load();
    } catch (err) {
      setError(err.message || 'Não foi possível gerar o convite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Usuários" lead="O cargo vale dentro deste condomínio. A Gestão Técnica cria a conta ou envia um link.">
      <Alert error={error} ok={ok} />
      <div className="table-wrap panel">
        {!rows.length ? <Empty text="Nenhum vínculo." /> : (
          <table>
            <thead><tr><th>Nome</th><th>E-mail</th><th>Cargo</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.usuarios?.nome}</td>
                  <td>{row.usuarios?.email}</td>
                  <td>{row.cargos?.nome || CARGO_LABEL[row.cargos?.tipo]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canManage ? (
        <div className="grid grid-2" style={{ marginTop: 16 }}>
          <form className="panel stack" onSubmit={onCreate}>
            <h2>Criar usuário</h2>
            <p className="hint">Cria o login e já vincula a este condomínio. Você continua autenticado. Não envia e-mail do Auth.</p>
            <Field label="Nome">
              <input value={createForm.nome} onChange={(e) => setCreateForm({ ...createForm, nome: e.target.value })} required />
            </Field>
            <Field label="E-mail">
              <input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} required />
            </Field>
            <Field label="Senha">
              <input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} minLength={6} required />
            </Field>
            <Field label="Cargo">
              <select value={createForm.cargo} onChange={(e) => setCreateForm({ ...createForm, cargo: e.target.value, unidadeTexto: '' })}>
                {CARGOS_CONVITE.map((tipo) => (
                  <option key={tipo} value={tipo}>{CARGO_LABEL[tipo]}</option>
                ))}
              </select>
            </Field>
            {createForm.cargo === 'morador' ? (
              <Field label="Unidade em que mora">
                <input
                  value={createForm.unidadeTexto}
                  onChange={(e) => setCreateForm({ ...createForm, unidadeTexto: e.target.value })}
                  placeholder={UNIDADE_PLACEHOLDER}
                  required
                />
              </Field>
            ) : null}
            {createForm.cargo === 'morador' ? <p className="hint">{UNIDADE_HINT}</p> : null}
            <Btn type="submit" icon="user" disabled={busy}>{busy ? 'Salvando…' : 'Criar usuário'}</Btn>
          </form>

          <form className="panel stack" onSubmit={onInvite}>
            <h2>Gerar link de convite</h2>
            <p className="hint">A pessoa abre o link, cria a conta e entra já vinculada a este condomínio. Vale 14 dias.</p>
            <Field label="E-mail (opcional)">
              <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
            </Field>
            <Field label="Cargo">
              <select value={inviteForm.cargo} onChange={(e) => setInviteForm({ ...inviteForm, cargo: e.target.value, unidadeTexto: '' })}>
                {CARGOS_CONVITE.map((tipo) => (
                  <option key={tipo} value={tipo}>{CARGO_LABEL[tipo]}</option>
                ))}
              </select>
            </Field>
            {inviteForm.cargo === 'morador' ? (
              <Field label="Unidade em que mora">
                <input
                  value={inviteForm.unidadeTexto}
                  onChange={(e) => setInviteForm({ ...inviteForm, unidadeTexto: e.target.value })}
                  placeholder={UNIDADE_PLACEHOLDER}
                  required
                />
              </Field>
            ) : null}
            {inviteForm.cargo === 'morador' ? <p className="hint">{UNIDADE_HINT}</p> : null}
            <Btn type="submit" icon="copy" disabled={busy}>{busy ? 'Gerando…' : 'Gerar e copiar link'}</Btn>
            {link ? (
              <p className="hint" style={{ wordBreak: 'break-all' }}>{link}</p>
            ) : null}
          </form>
        </div>
      ) : null}

      {canManage && convites.length ? (
        <div className="table-wrap panel" style={{ marginTop: 16 }}>
          <h2>Convites</h2>
          <table>
            <thead><tr><th>Cargo</th><th>Unidade</th><th>E-mail</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {convites.map((row) => (
                <tr key={row.id}>
                  <td>{CARGO_LABEL[row.cargo] || row.cargo}</td>
                  <td>{row.unidade || '—'}</td>
                  <td>{row.email || '—'}</td>
                  <td>{row.usado_em ? 'Usado' : (new Date(row.expires_at) < new Date() ? 'Expirado' : 'Aberto')}</td>
                  <td>
                    {!row.usado_em ? (
                      <Btn
                        variant="ghost"
                        icon="copy"
                        onClick={async () => {
                          const url = inviteUrl(row.token);
                          setLink(url);
                          await copiarTexto(url);
                          setOk('Link copiado.');
                        }}
                      >
                        Copiar link
                      </Btn>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Page>
  );
}

export function PerfilPage() {
  const { profile, session } = useSession();
  const [form, setForm] = useState({ nome: '', telefone: '' });
  const [ok, setOk] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (profile) setForm({ nome: profile.nome || '', telefone: profile.telefone || '' });
  }, [profile]);

  async function save(e) {
    e.preventDefault();
    const { error: err } = await supabase.from('usuarios').update(form).eq('id', session.user.id);
    if (err) setError(err.message);
    else setOk('Perfil atualizado.');
  }

  return (
    <Page title="Meu perfil">
      <Alert error={error} ok={ok} />
      <form className="panel stack" onSubmit={save}>
        <Field label="Nome"><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required /></Field>
        <Field label="Telefone"><input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></Field>
        <p className="muted">{session.user.email}</p>
        <Btn type="submit" icon="check">Salvar</Btn>
      </form>
    </Page>
  );
}
