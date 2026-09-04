import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { CARGO_LABEL } from '../lib/permissions';
import { criarConvite, criarLoginSemTrocarSessao, listarConvites, listarUsuariosCondominio, vincularUsuario } from '../lib/api';
import { copiarTexto } from '../lib/parseSeed';
import { conviteUrl } from '../lib/branding';
import { formatDateTime } from '../lib/format';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { DetailFields, Modal } from '../components/DataList';

const CARGOS_CONVITE = ['administrador', 'construtora', 'administracao', 'morador'];
const EMPTY_UNIDADE = { bloco: '', torre: '', casa: '', apartamento: '' };

function limparParte(value) {
  return String(value || '').trim();
}

/** Monta o texto que o backend já entende (ex.: Bloco A / Apt 101). */
function montarUnidadeTexto({ bloco, torre, casa, apartamento }) {
  const b = limparParte(bloco).replace(/^(bloco)\s+/i, '');
  const t = limparParte(torre).replace(/^(torre)\s+/i, '');
  const c = limparParte(casa).replace(/^(casa)\s+/i, '');
  const a = limparParte(apartamento).replace(/^(apto|apt\.?|apartamento)\s+/i, '');

  const esquerda = [
    b ? `Bloco ${b}` : '',
    t ? `Torre ${t}` : '',
  ].filter(Boolean).join(' · ');

  const direita = c ? `Casa ${c}` : (a ? `Apt ${a}` : '');

  if (esquerda && direita) return `${esquerda} / ${direita}`;
  return direita || esquerda || '';
}

function UnidadeFields({ value, onChange, required }) {
  const v = { ...EMPTY_UNIDADE, ...(value || {}) };
  const preview = montarUnidadeTexto(v);

  function set(key, next) {
    onChange({ ...v, [key]: next });
  }

  return (
    <div className="unidade-fields stack">
      <p className="hint" style={{ margin: 0 }}>Preencha o que existir na unidade do morador.</p>
      <div className="grid grid-2">
        <Field label="Bloco">
          <input
            value={v.bloco}
            onChange={(e) => set('bloco', e.target.value)}
            placeholder="A, B, 1…"
          />
        </Field>
        <Field label="Torre">
          <input
            value={v.torre}
            onChange={(e) => set('torre', e.target.value)}
            placeholder="1, Única…"
          />
        </Field>
        <Field label="Casa">
          <input
            value={v.casa}
            onChange={(e) => set('casa', e.target.value)}
            placeholder="12"
            required={required && !limparParte(v.apartamento)}
          />
        </Field>
        <Field label="Apartamento">
          <input
            value={v.apartamento}
            onChange={(e) => set('apartamento', e.target.value)}
            placeholder="101"
            required={required && !limparParte(v.casa)}
          />
        </Field>
      </div>
      {preview ? (
        <p className="hint unidade-preview">Unidade: <strong>{preview}</strong></p>
      ) : (
        <p className="hint">Informe ao menos a casa ou o apartamento.</p>
      )}
    </div>
  );
}

function statusConvite(row) {
  if (row?.usado_em) return 'Usado';
  if (row?.expires_at && new Date(row.expires_at) < new Date()) return 'Expirado';
  return 'Aberto';
}

/** Modal com usuários do condomínio, formulários e convites recentes. */
export function UsuariosGestaoModal({ open, condoId, condoNome = '', onClose }) {
  const [rows, setRows] = useState([]);
  const [convites, setConvites] = useState([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [tab, setTab] = useState('criar');
  const [createForm, setCreateForm] = useState({
    nome: '', email: '', password: '', cargo: 'morador', unidade: { ...EMPTY_UNIDADE },
  });
  const [inviteForm, setInviteForm] = useState({
    email: '', cargo: 'morador', unidade: { ...EMPTY_UNIDADE },
  });
  const [selectedConvite, setSelectedConvite] = useState(null);

  async function load() {
    if (!condoId) return;
    setError('');
    try {
      setRows(await listarUsuariosCondominio(condoId));
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os usuários.');
      setRows([]);
    }
    try {
      setConvites(await listarConvites(condoId));
    } catch (inviteErr) {
      setError(inviteErr.message || 'Não foi possível carregar os convites.');
    }
  }

  useEffect(() => {
    if (!open || !condoId) return;
    setError('');
    setOk('');
    setLink('');
    load();
  }, [open, condoId]);

  async function onCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      const unidadeTexto = createForm.cargo === 'morador' ? montarUnidadeTexto(createForm.unidade) : null;
      if (createForm.cargo === 'morador' && !unidadeTexto) {
        throw new Error('Informe a casa ou o apartamento do morador.');
      }

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
        unidadeTexto,
        nome: createForm.nome,
      });
      setCreateForm({ nome: '', email: '', password: '', cargo: 'morador', unidade: { ...EMPTY_UNIDADE } });
      setOk('Usuário criado e vinculado a este condomínio.');
      await load();
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
      const unidadeTexto = inviteForm.cargo === 'morador' ? montarUnidadeTexto(inviteForm.unidade) : null;
      if (inviteForm.cargo === 'morador' && !unidadeTexto) {
        throw new Error('Informe a casa ou o apartamento do morador.');
      }

      const token = await criarConvite({
        condominioId: condoId,
        cargo: inviteForm.cargo,
        email: inviteForm.email,
        unidadeTexto,
      });
      const url = conviteUrl(token);
      setLink(url);
      await copiarTexto(url);
      setOk('Link gerado e copiado. Envie para a pessoa criar o próprio acesso.');
      setInviteForm({ email: '', cargo: inviteForm.cargo, unidade: { ...EMPTY_UNIDADE } });
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível gerar o convite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        title={condoNome ? `Usuários · ${condoNome}` : 'Usuários do condomínio'}
        onClose={onClose}
        className="modal-sheet--wide"
      >
        <div className="usuarios-modal">
          <Alert error={error} ok={ok} />

          <section className="usuarios-modal-section">
            <header className="usuarios-modal-head">
              <h3>Usuários do condomínio</h3>
              <span className="muted">{rows.length} vínculo(s)</span>
            </header>
            {!rows.length ? (
              <Empty text="Nenhum usuário vinculado ainda." />
            ) : (
              <ul className="usuarios-nome-unidade">
                {rows.map((row) => (
                  <li key={row.id} className="usuarios-nome-unidade-item">
                    <strong className="usuarios-nome">{row.nome}</strong>
                    <span className="usuarios-unidade">{row.unidade}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="usuarios-modal-section">
            <header className="usuarios-modal-head">
              <h3>Criar acesso</h3>
              <div className="row usuarios-modal-tabs">
                <button
                  type="button"
                  className={tab === 'criar' ? 'btn' : 'btn-ghost'}
                  onClick={() => setTab('criar')}
                >
                  Criar usuário
                </button>
                <button
                  type="button"
                  className={tab === 'convite' ? 'btn' : 'btn-ghost'}
                  onClick={() => setTab('convite')}
                >
                  Gerar convite
                </button>
              </div>
            </header>

            {tab === 'criar' ? (
              <form className="stack usuarios-modal-form" onSubmit={onCreate}>
                <p className="hint">Cria o login e já vincula a este condomínio. Você continua autenticado.</p>
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
                  <select
                    value={createForm.cargo}
                    onChange={(e) => setCreateForm({ ...createForm, cargo: e.target.value, unidade: { ...EMPTY_UNIDADE } })}
                  >
                    {CARGOS_CONVITE.map((tipo) => (
                      <option key={tipo} value={tipo}>{CARGO_LABEL[tipo]}</option>
                    ))}
                  </select>
                </Field>
                {createForm.cargo === 'morador' ? (
                  <UnidadeFields
                    value={createForm.unidade}
                    onChange={(unidade) => setCreateForm({ ...createForm, unidade })}
                    required
                  />
                ) : null}
                <Btn type="submit" icon="user" disabled={busy}>{busy ? 'Salvando…' : 'Criar usuário'}</Btn>
              </form>
            ) : (
              <form className="stack usuarios-modal-form" onSubmit={onInvite}>
                <p className="hint">A pessoa abre o link, cria a conta e entra já vinculada. Vale 14 dias.</p>
                <Field label="E-mail (opcional)">
                  <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
                </Field>
                <Field label="Cargo">
                  <select
                    value={inviteForm.cargo}
                    onChange={(e) => setInviteForm({ ...inviteForm, cargo: e.target.value, unidade: { ...EMPTY_UNIDADE } })}
                  >
                    {CARGOS_CONVITE.map((tipo) => (
                      <option key={tipo} value={tipo}>{CARGO_LABEL[tipo]}</option>
                    ))}
                  </select>
                </Field>
                {inviteForm.cargo === 'morador' ? (
                  <UnidadeFields
                    value={inviteForm.unidade}
                    onChange={(unidade) => setInviteForm({ ...inviteForm, unidade })}
                    required
                  />
                ) : null}
                <Btn type="submit" icon="copy" disabled={busy}>{busy ? 'Gerando…' : 'Gerar e copiar link'}</Btn>
                {link ? <p className="hint" style={{ wordBreak: 'break-all' }}>{link}</p> : null}
              </form>
            )}
          </section>

          <section className="usuarios-modal-section">
            <header className="usuarios-modal-head">
              <h3>Convites recentes</h3>
              <span className="muted">{convites.length} registro(s)</span>
            </header>
            {!convites.length ? (
              <Empty text="Nenhum convite gerado ainda." />
            ) : (
              <ul className="convites-lista">
                {convites.map((row) => {
                  const status = statusConvite(row);
                  const statusKey = status.toLowerCase();
                  const titulo = row.unidade || (CARGO_LABEL[row.cargo] || row.cargo || 'Convite');
                  const quando = row.usado_em
                    ? `Usado em ${formatDateTime(row.usado_em)}`
                    : status === 'Expirado' && row.expires_at
                      ? `Expirou em ${formatDateTime(row.expires_at)}`
                      : row.created_at
                        ? `Criado em ${formatDateTime(row.created_at)}`
                        : null;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="convite-item"
                        onClick={() => setSelectedConvite(row)}
                      >
                        <div className="convite-item-top">
                          <strong className="convite-item-titulo">{titulo}</strong>
                          <span className={`convite-status convite-status--${statusKey}`}>{status}</span>
                        </div>
                        <div className="convite-item-meta">
                          <span className="convite-item-cargo">{CARGO_LABEL[row.cargo] || row.cargo}</span>
                          {row.email ? <span className="convite-item-email">{row.email}</span> : null}
                          {quando ? <span className="convite-item-quando">{quando}</span> : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </Modal>

      <Modal
        open={Boolean(selectedConvite)}
        title={CARGO_LABEL[selectedConvite?.cargo] || selectedConvite?.cargo || 'Convite'}
        onClose={() => setSelectedConvite(null)}
        footer={selectedConvite && !selectedConvite.usado_em && statusConvite(selectedConvite) === 'Aberto' ? (
          <Btn
            icon="copy"
            onClick={async () => {
              const url = conviteUrl(selectedConvite.token);
              setLink(url);
              await copiarTexto(url);
              setOk('Link copiado.');
              setSelectedConvite(null);
            }}
          >
            Copiar link
          </Btn>
        ) : null}
      >
        <DetailFields
          fields={[
            { label: 'Cargo', value: CARGO_LABEL[selectedConvite?.cargo] || selectedConvite?.cargo },
            { label: 'Unidade', value: selectedConvite?.unidade || '—' },
            { label: 'E-mail', value: selectedConvite?.email || '—' },
            { label: 'Status', value: statusConvite(selectedConvite) },
            { label: 'Criado em', value: selectedConvite?.created_at ? formatDateTime(selectedConvite.created_at) : '—' },
            { label: 'Usado em', value: selectedConvite?.usado_em ? formatDateTime(selectedConvite.usado_em) : '—' },
            { label: 'Expira em', value: selectedConvite?.expires_at ? formatDateTime(selectedConvite.expires_at) : '—' },
          ]}
        />
      </Modal>
    </>
  );
}

export function UsuariosPage() {
  const { condoId, condo } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [gestaoOpen, setGestaoOpen] = useState(false);
  const { showEditButton, editing, setEditing, toggleEditing } = useEditTela('manage_users');

  async function load() {
    if (!condoId) return;
    try {
      setRows(await listarUsuariosCondominio(condoId));
    } catch (err) {
      setError(err.message);
      setRows([]);
    }
  }

  useEffect(() => { if (condoId) load(); }, [condoId]);

  useEffect(() => {
    if (searchParams.get('criar') !== '1' || !showEditButton) return;
    setGestaoOpen(true);
    setEditing(true);
    const next = new URLSearchParams(searchParams);
    next.delete('criar');
    setSearchParams(next, { replace: true });
  }, [showEditButton, searchParams, condoId, setEditing, setSearchParams]);

  useEffect(() => {
    if (editing && showEditButton) setGestaoOpen(true);
  }, [editing, showEditButton]);

  return (
    <Page
      title="Usuários"
      lead="O cargo vale dentro deste condomínio. A Gestão Técnica cria a conta ou envia um link."
      actions={showEditButton ? (
        <div className="row">
          <Btn icon="users" onClick={() => { setGestaoOpen(true); setEditing(true); }}>
            Gerenciar usuários
          </Btn>
          <EditTelaButton editing={editing} onToggle={toggleEditing} />
        </div>
      ) : null}
    >
      <Alert error={error} />
      {!rows.length ? (
        <Empty text="Nenhum vínculo." />
      ) : (
        <ul className="usuarios-nome-unidade">
          {rows.map((row) => (
            <li key={row.id} className="usuarios-nome-unidade-item">
              <strong className="usuarios-nome">{row.nome}</strong>
              <span className="usuarios-unidade">{row.unidade}</span>
            </li>
          ))}
        </ul>
      )}

      <UsuariosGestaoModal
        open={gestaoOpen && showEditButton}
        condoId={condoId}
        condoNome={condo?.nome || ''}
        onClose={() => {
          setGestaoOpen(false);
          setEditing(false);
          load();
        }}
      />
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
