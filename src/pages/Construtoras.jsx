import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import {
  criarConstrutora,
  criarConviteConstrutora,
  criarUsuarioConstrutora,
  listarConstrutoras,
  listarConvitesConstrutora,
  listarUsuariosConstrutora,
  salvarDominioConstrutora,
  salvarEscopoUsuarioConstrutora,
  salvarFotoUsuario,
  urlFotoUsuario,
} from '../lib/api';
import { GestaoBar } from '../components/GestaoBar';
import { Alert, AppLogo, Btn, Empty, Field, MaskedInput, UserAvatar } from '../components/ui';
import { Icon } from '../components/icons';
import { formatCnpj, formatDateTime } from '../lib/format';
import { copiarTexto } from '../lib/parseSeed';
import { conviteUrl, dominioUrlDoCondominio, loadBranding, loadBrandingConstrutora, loginUrlDaConstrutora, nomeExibicaoConstrutora } from '../lib/branding';
import { DetailFields, Modal } from '../components/DataList';
import { ESCOPO_TODOS, EscopoCondominios, FotoPicker, validarEscopo } from '../components/UsuarioCampos';

const EMPTY_FORM = {
  razao_social: '',
  nome_fantasia: '',
  cnpj: '',
  email: '',
  descricao: '',
};

export function ConstrutorasPortal() {
  const { error: sessionError } = useSession();
  const [rows, setRows] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [logo, setLogo] = useState(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingDominioId, setEditingDominioId] = useState('');
  const [dominioDraft, setDominioDraft] = useState('');
  const [savingDominio, setSavingDominio] = useState('');
  const [usuariosModal, setUsuariosModal] = useState({ open: false, id: '', nome: '' });

  async function load() {
    try {
      setRows(await listarConstrutoras());
      setError('');
    } catch (err) {
      setRows([]);
      setError(err.message || 'Não foi possível carregar as construtoras. Rode o SQL construtoras.sql no Supabase.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!logo) {
      setLogoPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function copiarLink(url, label) {
    if (!url) return;
    await copiarTexto(url);
    setOk(`${label} copiado.`);
    setError('');
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      await criarConstrutora({ ...form, logo });
      setForm(EMPTY_FORM);
      setLogo(null);
      setCreating(false);
      setOk('Construtora criada.');
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível criar a construtora.');
    } finally {
      setBusy(false);
    }
  }

  async function salvarDominioDoCard(row) {
    const dominio = String(dominioDraft || '').trim();
    const okConfirm = window.confirm(
      dominio
        ? `Salvar o domínio "${dominio}" nesta construtora?`
        : 'Remover o domínio personalizado desta construtora?',
    );
    if (!okConfirm) return;
    setSavingDominio(row.id);
    setError('');
    setOk('');
    try {
      const saved = await salvarDominioConstrutora(row.id, dominioDraft);
      setEditingDominioId('');
      setDominioDraft('');
      setOk(saved ? `Domínio salvo: ${saved}` : 'Domínio removido.');
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível salvar o domínio.');
    } finally {
      setSavingDominio('');
    }
  }

  return (
    <div className="portal">
      <GestaoBar />
      <main className="portal-main">
        <div className="portal-hero">
          <AppLogo className="portal-hero-logo" alt="CCA" />
          <div className="portal-toolbar">
            {!creating ? (
              <Btn
                icon="plus"
                className="btn-round"
                aria-label="Criar construtora"
                onClick={() => setCreating(true)}
              />
            ) : (
              <Btn
                variant="ghost"
                icon="x"
                className="btn-round"
                aria-label="Cancelar"
                onClick={() => setCreating(false)}
              />
            )}
          </div>
        </div>

        <Alert error={error || sessionError} ok={ok} />

        {creating ? (
          <form className="stack panel" onSubmit={onSubmit} style={{ marginBottom: 24 }}>
            <h2>Nova construtora</h2>
            <Field label="Logomarca">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/*"
                onChange={(e) => setLogo(e.target.files?.[0] || null)}
                required
              />
            </Field>
            {logoPreview ? (
              <div className="forn-logo-slot" style={{ marginTop: 0 }}>
                <span className="forn-logo-preview has-file">
                  <img src={logoPreview} alt="" />
                </span>
                <span className="forn-logo-copy">
                  <strong>{logo?.name}</strong>
                  <small>Logomarca da construtora</small>
                </span>
              </div>
            ) : null}
            <Field label="Razão social">
              <input
                value={form.razao_social}
                onChange={(e) => setField('razao_social', e.target.value)}
                placeholder="Ex.: Construtora Aurora Ltda"
                required
              />
            </Field>
            <Field label="Nome fantasia">
              <input
                value={form.nome_fantasia}
                onChange={(e) => setField('nome_fantasia', e.target.value)}
                placeholder="Ex.: Aurora"
                required
              />
            </Field>
            <div className="grid grid-2">
              <Field label="CNPJ">
                <MaskedInput
                  mask="cnpj"
                  value={form.cnpj}
                  onChange={(cnpj) => setField('cnpj', cnpj)}
                  placeholder="00.000.000/0000-00"
                />
              </Field>
              <Field label="E-mail">
                <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
              </Field>
            </div>
            <Field label="Descrição">
              <textarea value={form.descricao} onChange={(e) => setField('descricao', e.target.value)} />
            </Field>
            <Btn type="submit" icon="check" disabled={busy}>
              {busy ? 'Criando…' : 'Criar construtora'}
            </Btn>
          </form>
        ) : null}

        {!rows.length && !creating ? (
          <div className="panel">
            <Empty text="Nenhuma construtora cadastrada. Clique em criar." />
          </div>
        ) : (
          <div className="condo-grid">
            {rows.map((row) => {
              const displayNome = nomeExibicaoConstrutora(row);
              const loginUrl = loginUrlDaConstrutora(row.id, displayNome);
              const dominioSalvo = row.dominio || '';
              const dominioUrl = dominioUrlDoCondominio(dominioSalvo);
              const editing = editingDominioId === row.id;
              const saving = savingDominio === row.id;
              return (
                <article key={row.id} className="condo-card">
                  <header className="condo-card-head">
                    <strong>{displayNome}</strong>
                    {row.ativo === false ? <span className="condo-status">Inativa</span> : null}
                  </header>
                  {row.razao_social && row.razao_social !== displayNome ? (
                    <p className="muted" style={{ margin: 0 }}>{row.razao_social}</p>
                  ) : null}
                  {row.cnpj ? <p className="muted" style={{ margin: 0 }}>{formatCnpj(row.cnpj) || row.cnpj}</p> : null}

                  <div className="condo-links">
                    <div className="condo-link">
                      <span className="condo-link-label">Login</span>
                      <p>{loginUrl}</p>
                      <Btn
                        variant="ghost"
                        icon="copy"
                        className="condo-copy"
                        aria-label="Copiar login"
                        onClick={() => copiarLink(loginUrl, 'Link de login')}
                      />
                    </div>
                    {dominioUrl ? (
                      <div className="condo-link">
                        <span className="condo-link-label">Domínio</span>
                        <p>{dominioUrl}</p>
                        <Btn
                          variant="ghost"
                          icon="copy"
                          className="condo-copy"
                          aria-label="Copiar domínio"
                          onClick={() => copiarLink(dominioUrl, 'Domínio')}
                        />
                      </div>
                    ) : null}
                  </div>

                  {editing ? (
                    <div className="condo-domain-edit">
                      <Field label="Domínio personalizado">
                        <input
                          value={dominioDraft}
                          onChange={(e) => setDominioDraft(e.target.value)}
                          placeholder="construtora.com.br"
                          autoFocus
                        />
                      </Field>
                      <div className="row">
                        <Btn icon="check" disabled={saving} onClick={() => salvarDominioDoCard(row)}>
                          {saving ? 'Salvando…' : 'Salvar'}
                        </Btn>
                        <Btn
                          variant="ghost"
                          icon="x"
                          disabled={saving}
                          onClick={() => {
                            setEditingDominioId('');
                            setDominioDraft('');
                          }}
                        >
                          Cancelar
                        </Btn>
                      </div>
                    </div>
                  ) : null}

                  <div className="condo-card-actions">
                    {editing ? null : (
                      <Btn
                        variant="ghost"
                        icon={dominioSalvo ? 'pencil' : 'plus'}
                        onClick={() => {
                          setEditingDominioId(row.id);
                          setDominioDraft(row.dominio || '');
                        }}
                      >
                        Domínio
                      </Btn>
                    )}
                    <Btn
                      variant="ghost"
                      icon="plus"
                      onClick={() => setUsuariosModal({ open: true, id: row.id, nome: displayNome })}
                    >
                      Usuários
                    </Btn>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <UsuariosConstrutoraModal
        open={usuariosModal.open}
        construtoraId={usuariosModal.id}
        nome={usuariosModal.nome}
        onClose={() => setUsuariosModal({ open: false, id: '', nome: '' })}
      />
    </div>
  );
}

function statusConvite(row) {
  if (row?.usado_em) return 'Usado';
  if (row?.expires_at && new Date(row.expires_at) < new Date()) return 'Expirado';
  return 'Aberto';
}

function condominiosDoUsuario(row) {
  const value = row?.condominios;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function escopoDoUsuario(row) {
  const condos = condominiosDoUsuario(row);
  const todos = row?.todos_condominios !== false;
  return {
    todos,
    ids: todos ? [] : condos.map((item) => item.id).filter(Boolean),
  };
}

function rotuloEscopo(row) {
  const condos = condominiosDoUsuario(row);
  if (row?.todos_condominios === false) {
    const nomes = condos.map((item) => item.nome).filter(Boolean);
    return nomes.length ? nomes.join(', ') : 'Condomínios específicos';
  }
  return 'Todos os condomínios';
}

function UsuariosConstrutoraModal({ open, construtoraId, nome, onClose }) {
  const [rows, setRows] = useState([]);
  const [convites, setConvites] = useState([]);
  const [fotos, setFotos] = useState({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [tab, setTab] = useState('criar');
  const [createForm, setCreateForm] = useState({ nome: '', email: '', password: '', escopo: ESCOPO_TODOS });
  const [foto, setFoto] = useState(null);
  const [inviteForm, setInviteForm] = useState({ email: '', escopo: ESCOPO_TODOS });
  const [selectedConvite, setSelectedConvite] = useState(null);
  const [editUserId, setEditUserId] = useState('');
  const [editEscopo, setEditEscopo] = useState(ESCOPO_TODOS);

  async function load() {
    if (!construtoraId) return;
    try {
      const list = await listarUsuariosConstrutora(construtoraId);
      setRows(list);
      const urls = {};
      await Promise.all((list || []).map(async (row) => {
        if (!row.foto_path) return;
        urls[row.id] = await urlFotoUsuario(row.foto_path);
      }));
      setFotos(urls);
      setError('');
    } catch (err) {
      setRows([]);
      setError(err.message || 'Não foi possível listar os usuários.');
    }
    try {
      setConvites(await listarConvitesConstrutora(construtoraId));
    } catch {
      setConvites([]);
    }
  }

  useEffect(() => {
    if (!open || !construtoraId) return;
    setError('');
    setOk('');
    setLink('');
    setEditUserId('');
    setEditEscopo(ESCOPO_TODOS);
    load();
  }, [open, construtoraId]);

  async function onCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      const userId = await criarUsuarioConstrutora({
        construtoraId,
        email: createForm.email,
        password: createForm.password,
        nome: createForm.nome,
        escopoCondominioIds: validarEscopo(createForm.escopo),
      });
      if (foto && userId) await salvarFotoUsuario(userId, foto);
      setCreateForm({ nome: '', email: '', password: '', escopo: ESCOPO_TODOS });
      setFoto(null);
      setOk('Usuário da construtora criado.');
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
      const token = await criarConviteConstrutora({
        construtoraId,
        email: inviteForm.email,
        escopoCondominioIds: validarEscopo(inviteForm.escopo),
      });
      const url = conviteUrl(token);
      setLink(url);
      await copiarTexto(url);
      setOk('Link gerado e copiado. Envie para a pessoa preencher os dados.');
      setInviteForm({ email: '', escopo: inviteForm.escopo });
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível gerar o convite. Rode o SQL usuarios-foto-convites.sql no Supabase.');
    } finally {
      setBusy(false);
    }
  }

  function abrirEscopo(row) {
    setEditUserId(row.id);
    setEditEscopo(escopoDoUsuario(row));
    setError('');
    setOk('');
  }

  async function onSaveEscopo(e) {
    e.preventDefault();
    if (!editUserId) return;
    setBusy(true);
    setError('');
    setOk('');
    try {
      await salvarEscopoUsuarioConstrutora({
        usuarioId: editUserId,
        construtoraId,
        escopoCondominioIds: validarEscopo(editEscopo),
      });
      setEditUserId('');
      setEditEscopo(ESCOPO_TODOS);
      setOk('Condomínios desta pessoa atualizados.');
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível atualizar os condomínios.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        title={`Usuários · ${nome || 'Construtora'}`}
        onClose={onClose}
        className="modal-sheet--wide"
      >
        <div className="usuarios-modal">
          <Alert error={error} ok={ok} />

          <section className="usuarios-modal-section">
            <header className="usuarios-modal-head">
              <h3>Usuários da construtora</h3>
              <span className="muted">{rows.length} registro(s)</span>
            </header>
            {!rows.length ? (
              <Empty text="Nenhum usuário desta construtora ainda." />
            ) : (
              <ul className="data-list data-list--rich">
                {rows.map((row) => (
                  <li key={row.id} className="data-list-item data-list-item--static usuarios-escopo-item">
                    <UserAvatar src={fotos[row.id]} nome={row.nome || row.email} size={36} />
                    <span className="data-list-main">
                      <strong>{row.nome || row.email}</strong>
                      <span className="data-list-sub">
                        {[row.email, rotuloEscopo(row)].filter(Boolean).join(' · ')}
                      </span>
                      {editUserId === row.id ? (
                        <form className="stack usuarios-escopo-edit" onSubmit={onSaveEscopo}>
                          <EscopoCondominios
                            construtoraId={construtoraId}
                            todos={editEscopo.todos}
                            ids={editEscopo.ids}
                            onChange={setEditEscopo}
                          />
                          <div className="row">
                            <Btn type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar condomínios'}</Btn>
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={busy}
                              onClick={() => {
                                setEditUserId('');
                                setEditEscopo(ESCOPO_TODOS);
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </span>
                    {editUserId === row.id ? null : (
                      <button type="button" className="btn-ghost" onClick={() => abrirEscopo(row)}>
                        Alterar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="usuarios-modal-section">
            <header className="usuarios-modal-head">
              <h3>Criar acesso</h3>
              <div className="row usuarios-modal-tabs">
                <button type="button" className={tab === 'criar' ? 'btn' : 'btn-ghost'} onClick={() => setTab('criar')}>
                  Criar usuário
                </button>
                <button type="button" className={tab === 'convite' ? 'btn' : 'btn-ghost'} onClick={() => setTab('convite')}>
                  Gerar convite
                </button>
              </div>
            </header>

            {tab === 'criar' ? (
              <form className="stack usuarios-modal-form" onSubmit={onCreate}>
                <p className="hint">Cria o login e já vincula a esta construtora. Você continua autenticado.</p>
                <FotoPicker file={foto} onChange={setFoto} />
                <Field label="Nome">
                  <input value={createForm.nome} onChange={(e) => setCreateForm({ ...createForm, nome: e.target.value })} required />
                </Field>
                <Field label="E-mail">
                  <input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} required />
                </Field>
                <Field label="Senha">
                  <input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} minLength={8} required />
                </Field>
                <EscopoCondominios
                  construtoraId={construtoraId}
                  todos={createForm.escopo.todos}
                  ids={createForm.escopo.ids}
                  onChange={(escopo) => setCreateForm({ ...createForm, escopo })}
                />
                <Btn type="submit" icon="user" disabled={busy}>{busy ? 'Salvando…' : 'Criar usuário'}</Btn>
              </form>
            ) : (
              <form className="stack usuarios-modal-form" onSubmit={onInvite}>
                <p className="hint">A pessoa abre o link, preenche os dados (incluindo a foto) e entra já vinculada. Vale 14 dias.</p>
                <Field label="E-mail (opcional)">
                  <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
                </Field>
                <EscopoCondominios
                  construtoraId={construtoraId}
                  todos={inviteForm.escopo.todos}
                  ids={inviteForm.escopo.ids}
                  onChange={(escopo) => setInviteForm({ ...inviteForm, escopo })}
                />
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
                  const quando = row.usado_em
                    ? `Usado em ${formatDateTime(row.usado_em)}`
                    : status === 'Expirado' && row.expires_at
                      ? `Expirou em ${formatDateTime(row.expires_at)}`
                      : row.created_at
                        ? `Criado em ${formatDateTime(row.created_at)}`
                        : null;
                  return (
                    <li key={row.id}>
                      <button type="button" className="convite-item" onClick={() => setSelectedConvite(row)}>
                        <div className="convite-item-top">
                          <strong className="convite-item-titulo">{row.condominios || 'Todos os condomínios'}</strong>
                          <span className={`convite-status convite-status--${statusKey}`}>{status}</span>
                        </div>
                        <div className="convite-item-meta">
                          <span className="convite-item-cargo">Construtora</span>
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
        title="Convite da construtora"
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
            { label: 'Condomínios', value: selectedConvite?.condominios || 'Todos' },
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

export function ConstrutoraPortal() {
  const { memberships, selectCondo, construtora, error: sessionError } = useSession();
  const navigate = useNavigate();
  const [brand, setBrand] = useState({ nome: '', logo: '' });
  const [logos, setLogos] = useState({});

  useEffect(() => {
    if (!construtora?.id) return undefined;
    let live = true;
    loadBrandingConstrutora(construtora.id).then((next) => {
      if (live) setBrand(next);
    });
    return () => { live = false; };
  }, [construtora?.id]);

  const lista = useMemo(() => memberships || [], [memberships]);
  const nome = brand.nomeFantasia || brand.nome || nomeExibicaoConstrutora(construtora) || 'Construtora';

  useEffect(() => {
    let live = true;
    const ids = lista.map((row) => row.condominio_id).filter(Boolean);
    if (!ids.length) {
      setLogos({});
      return undefined;
    }
    Promise.all(ids.map(async (id) => {
      const next = await loadBranding(id);
      return [id, next.logo || ''];
    })).then((pairs) => {
      if (live) setLogos(Object.fromEntries(pairs));
    });
    return () => { live = false; };
  }, [lista]);

  function entrar(id) {
    selectCondo(id);
    navigate(`/construtora/${id}`);
  }

  return (
    <div className="portal">
      <GestaoBar variant="construtora" />
      <main className="portal-main">
        <div className="portal-hero">
          {brand.logo ? (
            <img className="portal-hero-logo" src={brand.logo} alt={nome} />
          ) : (
            <h1 className="portal-hero-title">{nome}</h1>
          )}
        </div>
        <Alert error={sessionError} />
        {!lista.length ? (
          <div className="panel">
            <Empty text="Nenhum condomínio vinculado a esta construtora." />
          </div>
        ) : (
          <div className="condo-grid">
            {lista.map((row) => {
              const condoNome = row.condominios?.nome || 'Condomínio';
              const logo = logos[row.condominio_id];
              return (
                <article key={row.id} className="condo-card">
                  <header className="condo-card-head">
                    <div className="condo-card-brand">
                      {logo ? <img className="condo-card-logo" src={logo} alt="" /> : (
                        <span className="condo-card-logo is-empty" aria-hidden="true">
                          <Icon name="building" size={22} />
                        </span>
                      )}
                      <strong>{condoNome}</strong>
                    </div>
                    {row.condominios?.ativo === false ? <span className="condo-status">Inativo</span> : null}
                  </header>
                  <div className="condo-card-actions">
                    <Btn icon="door" onClick={() => entrar(row.condominio_id)}>
                      Entrar
                    </Btn>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export function ConstrutorasPage() {
  return <ConstrutorasPortal />;
}
