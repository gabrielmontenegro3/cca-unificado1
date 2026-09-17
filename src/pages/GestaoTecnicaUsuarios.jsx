import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import {
  criarConviteGestaoTecnica,
  criarUsuarioGestaoTecnica,
  listarConvitesGestaoTecnica,
  listarUsuariosGestaoTecnica,
  salvarFotoUsuario,
  urlFotoUsuario,
} from '../lib/api';
import { formatDateTime } from '../lib/format';
import { copiarTexto } from '../lib/parseSeed';
import { conviteUrl } from '../lib/branding';
import { Alert, Btn, Empty, Field, Page, UserAvatar } from '../components/ui';
import { GestaoBar } from '../components/GestaoBar';
import { FotoPicker } from '../components/UsuarioCampos';
import { DetailFields, Modal } from '../components/DataList';

function statusConvite(row) {
  if (row?.usado_em) return 'Usado';
  if (row?.expires_at && new Date(row.expires_at) < new Date()) return 'Expirado';
  return 'Aberto';
}

export function GestaoTecnicaUsuariosPage() {
  const { isAdminSistema } = useSession();
  const [rows, setRows] = useState([]);
  const [convites, setConvites] = useState([]);
  const [fotos, setFotos] = useState({});
  const [form, setForm] = useState({ nome: '', email: '', password: '' });
  const [inviteEmail, setInviteEmail] = useState('');
  const [foto, setFoto] = useState(null);
  const [tab, setTab] = useState('criar');
  const [link, setLink] = useState('');
  const [selectedConvite, setSelectedConvite] = useState(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    try {
      const list = await listarUsuariosGestaoTecnica();
      setRows(list);
      const urls = {};
      await Promise.all((list || []).map(async (row) => {
        if (!row.foto_path) return;
        urls[row.id] = await urlFotoUsuario(row.foto_path);
      }));
      setFotos(urls);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar a Gestão Técnica. Rode o SQL admin-sistema.sql no Supabase.');
      setRows([]);
    }
    try {
      setConvites(await listarConvitesGestaoTecnica());
    } catch {
      setConvites([]);
    }
  }

  useEffect(() => {
    if (isAdminSistema) load();
  }, [isAdminSistema]);

  if (!isAdminSistema) return <Navigate to="/" replace />;

  async function onCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      const userId = await criarUsuarioGestaoTecnica(form);
      if (foto && userId) await salvarFotoUsuario(userId, foto);
      setForm({ nome: '', email: '', password: '' });
      setFoto(null);
      setOk('Usuário de Gestão Técnica criado.');
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
      const token = await criarConviteGestaoTecnica(inviteEmail);
      const url = conviteUrl(token);
      setLink(url);
      await copiarTexto(url);
      setOk('Link gerado e copiado. Envie para a pessoa preencher os dados e a foto.');
      setInviteEmail('');
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível gerar o convite. Rode o SQL usuarios-foto-convites.sql no Supabase.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal">
      <GestaoBar />
      <main className="portal-main wide">
        <Page
          title="Gestão Técnica"
          lead="Somente o Administrador do sistema cria esses logins. Eles acessam todos os condomínios e aparecem com selo verificado."
        >
          <Alert error={error} ok={ok} />

          <form className="panel stack" onSubmit={tab === 'criar' ? onCreate : onInvite}>
            <header className="usuarios-modal-head">
              <h2>Novo acesso</h2>
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
              <>
                <FotoPicker file={foto} onChange={setFoto} />
                <Field label="Nome">
                  <input
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    required
                  />
                </Field>
                <Field label="E-mail">
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Senha">
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    minLength={8}
                    required
                  />
                </Field>
                <Btn type="submit" icon="user" disabled={busy}>
                  {busy ? 'Salvando…' : 'Criar Gestão Técnica'}
                </Btn>
              </>
            ) : (
              <>
                <p className="hint">A pessoa abre o link, preenche nome, senha e foto, e entra já como Gestão Técnica verificada. Vale 14 dias.</p>
                <Field label="E-mail (opcional)">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </Field>
                <Btn type="submit" icon="copy" disabled={busy}>
                  {busy ? 'Gerando…' : 'Gerar e copiar link'}
                </Btn>
                {link ? <p className="hint" style={{ wordBreak: 'break-all' }}>{link}</p> : null}
              </>
            )}
          </form>

          <section className="panel stack" style={{ marginTop: 16 }}>
            <h2>Usuários cadastrados</h2>
            {!rows.length ? (
              <Empty text="Nenhum usuário de Gestão Técnica ainda." />
            ) : (
              <ul className="data-list data-list--rich">
                {rows.map((row) => (
                  <li key={row.id} className="data-list-item data-list-item--static">
                    <UserAvatar src={fotos[row.id]} nome={row.nome || row.email} verified size={40} />
                    <span className="data-list-main">
                      <strong className="user-name-verified">
                        {row.nome || row.email}
                      </strong>
                      <span className="data-list-sub">
                        {[row.email, row.created_at ? formatDateTime(row.created_at) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel stack" style={{ marginTop: 16 }}>
            <h2>Convites recentes</h2>
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
                          <strong className="convite-item-titulo">Gestão Técnica</strong>
                          <span className={`convite-status convite-status--${statusKey}`}>{status}</span>
                        </div>
                        <div className="convite-item-meta">
                          {row.email ? <span className="convite-item-email">{row.email}</span> : <span className="convite-item-cargo">Link aberto</span>}
                          {quando ? <span className="convite-item-quando">{quando}</span> : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </Page>
      </main>

      <Modal
        open={Boolean(selectedConvite)}
        title="Convite da Gestão Técnica"
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
            { label: 'E-mail', value: selectedConvite?.email || '—' },
            { label: 'Status', value: statusConvite(selectedConvite) },
            { label: 'Criado em', value: selectedConvite?.created_at ? formatDateTime(selectedConvite.created_at) : '—' },
            { label: 'Usado em', value: selectedConvite?.usado_em ? formatDateTime(selectedConvite.usado_em) : '—' },
            { label: 'Expira em', value: selectedConvite?.expires_at ? formatDateTime(selectedConvite.expires_at) : '—' },
          ]}
        />
      </Modal>
    </div>
  );
}
