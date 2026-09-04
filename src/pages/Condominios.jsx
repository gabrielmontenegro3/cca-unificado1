import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { can } from '../lib/permissions';
import { criarCondominio, salvarDominioCondominio } from '../lib/api';
import { GestaoBar } from '../components/GestaoBar';
import { Alert, AppLogo, Btn, Empty, Field, Toast } from '../components/ui';
import {
  PADROES,
  PADRAO_COMPLETO,
  EMPTY_UNIDADE_CONFIG,
  copiarTexto,
  gerarUnidadesDoConfig,
  resumoCriacaoCondominio,
  validarCriacaoCondominio,
} from '../lib/parseSeed';
import { loginUrlDoCondominio, dominioUrlDoCondominio } from '../lib/branding';
import { Modal } from '../components/DataList';
import { UnreadOrb } from '../components/UnreadOrb';
import { condominiosComNaoLidas } from '../lib/notifications';
import { UsuariosGestaoModal } from './Admin';

const DRAFT_KEY = 'cca.condoFormDraft';

const EMPTY_FORM = {
  nome: '',
  cnpj: '',
  email: '',
  descricao: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  estado: '',
  boletim_titulo: '',
  boletim_texto: '',
  catalogo_texto: '',
  fornecedores_texto: '',
  materiais_texto: '',
  locais_texto: '',
  garantias_texto: '',
  unidades_texto: '',
  unidade_config: { ...EMPTY_UNIDADE_CONFIG },
  contatos_texto: '',
  usuarios_texto: '',
};

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function PadraoBar({ padrao, value, onUse, onCopied }) {
  async function copy() {
    await copiarTexto(padrao);
    onCopied('Padrão copiado. Cole no campo e troque os [colchetes] pelos dados.');
  }

  function useHere() {
    onUse(value?.trim() ? `${value.trim()}\n${padrao}` : padrao);
    onCopied('Padrão colocado no campo. Troque os [colchetes] pelos dados reais.');
  }

  return (
    <div className="row padrao-bar">
      <Btn variant="ghost" icon="copy" onClick={copy}>Copiar padrão</Btn>
      <Btn variant="ghost" icon="file" onClick={useHere}>Usar padrão neste campo</Btn>
    </div>
  );
}

function UnidadesBuilder({ value, onChange }) {
  const cfg = { ...EMPTY_UNIDADE_CONFIG, ...(value || {}) };
  const geradas = gerarUnidadesDoConfig(cfg);
  const preview = geradas.slice(0, 8);

  function patch(partial) {
    onChange({ ...cfg, ...partial });
  }

  return (
    <div className="unidades-builder stack">
      <Field label="Tipo de condomínio">
        <select value={cfg.tipo} onChange={(e) => patch({ tipo: e.target.value })}>
          <option value="predios">Prédios / torres (apartamentos)</option>
          <option value="casas">Casas</option>
        </select>
      </Field>

      {cfg.tipo === 'predios' ? (
        <>
          <Field label="Estrutura">
            <select value={cfg.torres} onChange={(e) => patch({ torres: e.target.value })}>
              <option value="1">Só um prédio / uma torre</option>
              <option value="2">Duas torres / dois blocos</option>
              <option value="varios">Várias torres / blocos</option>
            </select>
          </Field>

          {cfg.torres === 'varios' ? (
            <>
              <Field label="Quantidade de torres / blocos">
                <input
                  type="number"
                  min={3}
                  max={26}
                  value={cfg.qtdTorres}
                  onChange={(e) => patch({ qtdTorres: e.target.value })}
                />
              </Field>
              <div className="grid grid-2">
                <Field label="Como se chamam">
                  <select value={cfg.nomeacao} onChange={(e) => patch({ nomeacao: e.target.value })}>
                    <option value="letra">Bloco A, B, C…</option>
                    <option value="numero">Bloco 1, 2, 3…</option>
                  </select>
                </Field>
                {cfg.nomeacao === 'letra' ? (
                  <Field label="Até qual letra">
                    <select value={cfg.ateLetra} onChange={(e) => patch({ ateLetra: e.target.value })}>
                      {LETRAS.map((letra) => (
                        <option key={letra} value={letra}>{letra}</option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Até qual número">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={cfg.ateNumero}
                      onChange={(e) => patch({ ateNumero: e.target.value })}
                    />
                  </Field>
                )}
              </div>
            </>
          ) : null}

          {cfg.torres === '2' ? (
            <Field label="Como se chamam">
              <select value={cfg.nomeacao} onChange={(e) => patch({ nomeacao: e.target.value })}>
                <option value="letra">Bloco A e Bloco B</option>
                <option value="numero">Bloco 1 e Bloco 2</option>
              </select>
            </Field>
          ) : null}

          <div className="grid grid-2">
            <Field label="Andares por torre">
              <input
                type="number"
                min={1}
                max={80}
                value={cfg.andares}
                onChange={(e) => patch({ andares: e.target.value })}
              />
            </Field>
            <Field label="Apartamentos por andar">
              <input
                type="number"
                min={1}
                max={40}
                value={cfg.unidadesPorAndar}
                onChange={(e) => patch({ unidadesPorAndar: e.target.value })}
              />
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field label="Quantidade de casas">
            <input
              type="number"
              min={1}
              max={500}
              value={cfg.qtdCasas}
              onChange={(e) => patch({ qtdCasas: e.target.value })}
            />
          </Field>
          <div className="grid grid-2">
            <Field label="Como se chamam">
              <select value={cfg.nomeacao} onChange={(e) => patch({ nomeacao: e.target.value })}>
                <option value="numero">Casa 1, 2, 3…</option>
                <option value="letra">Casa A, B, C…</option>
              </select>
            </Field>
            {cfg.nomeacao === 'letra' ? (
              <Field label="Até qual letra">
                <select value={cfg.ateLetra} onChange={(e) => patch({ ateLetra: e.target.value })}>
                  {LETRAS.map((letra) => (
                    <option key={letra} value={letra}>{letra}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Até qual número">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={cfg.ateNumero}
                  onChange={(e) => patch({ ateNumero: e.target.value })}
                />
              </Field>
            )}
          </div>
        </>
      )}

      <div className="unidades-preview">
        <p className="hint" style={{ margin: 0 }}>
          Serão criadas <strong>{geradas.length}</strong> unidade(s).
        </p>
        {preview.length ? (
          <ul>
            {preview.map((row) => (
              <li key={row.identificacao}>{row.identificacao}</li>
            ))}
            {geradas.length > preview.length ? (
              <li className="muted">… e mais {geradas.length - preview.length}</li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="form-section">
      <h3>{title}</h3>
      {hint ? <p className="hint">{hint}</p> : null}
      <div className="stack">{children}</div>
    </section>
  );
}

export function CondominiosPortal() {
  const { cargoTipo, memberships, selectCondo, reloadMemberships, session, error: sessionError } = useSession();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(() => {
    try {
      return Boolean(JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}').creating);
    } catch {
      return false;
    }
  });
  const [form, setForm] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}').form || {};
      return {
        ...EMPTY_FORM,
        ...saved,
        unidade_config: { ...EMPTY_UNIDADE_CONFIG, ...(saved.unidade_config || {}) },
      };
    } catch {
      return EMPTY_FORM;
    }
  });
  const [files, setFiles] = useState({
    logo: null,
    imagem_visao_geral: null,
    imagem_capa: null,
    imagem_login: null,
    imagens: [],
    documentos: [],
  });
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [toast, setToast] = useState({ message: '', type: 'error' });
  const [busy, setBusy] = useState(false);
  const [editingDominioId, setEditingDominioId] = useState('');
  const [dominioDraft, setDominioDraft] = useState('');
  const [savingDominio, setSavingDominio] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmResumo, setConfirmResumo] = useState(null);
  const [unreadByCondo, setUnreadByCondo] = useState({});
  const [usuariosModal, setUsuariosModal] = useState({ open: false, condoId: '', nome: '' });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const map = await condominiosComNaoLidas();
        if (live) setUnreadByCondo(map || {});
      } catch {
        if (live) setUnreadByCondo({});
      }
    })();
    return () => { live = false; };
  }, [memberships]);

  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ creating, form }));
  }, [creating, form]);

  function clearDraft() {
    sessionStorage.removeItem(DRAFT_KEY);
    setForm(EMPTY_FORM);
    setCreating(false);
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setFile(key, value) {
    setFiles((prev) => ({ ...prev, [key]: value }));
  }

  async function openCondo(id) {
    selectCondo(id);
    navigate('/visao-geral');
  }

  function abrirEditorDominio(row) {
    setEditingDominioId(row.condominio_id);
    setDominioDraft(row.condominios?.dominio || '');
  }

  function fecharEditorDominio() {
    setEditingDominioId('');
    setDominioDraft('');
  }

  async function copiarLink(url, label) {
    if (!url) return;
    await copiarTexto(url);
    setOk(`${label} copiado.`);
    setError('');
  }

  async function salvarDominioDoCard(row) {
    const dominio = String(dominioDraft || '').trim();
    const okConfirm = window.confirm(
      dominio
        ? `Salvar o domínio "${dominio}" neste condomínio?`
        : 'Remover o domínio personalizado deste condomínio?',
    );
    if (!okConfirm) return;

    setSavingDominio(row.condominio_id);
    setError('');
    setOk('');
    try {
      const saved = await salvarDominioCondominio(row.condominio_id, dominioDraft);
      await reloadMemberships();
      fecharEditorDominio();
      setOk(saved ? `Domínio salvo: ${saved}` : 'Domínio removido.');
    } catch (err) {
      setError(err.message || 'Não foi possível salvar o domínio.');
    } finally {
      setSavingDominio('');
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setOk('');
    const issues = validarCriacaoCondominio({ ...form, ...files });
    if (issues.length) {
      setError(issues[0]);
      return;
    }
    setConfirmResumo(resumoCriacaoCondominio({ ...form, ...files }));
    setConfirmOpen(true);
  }

  async function confirmarCriacao() {
    setBusy(true);
    setError('');
    setOk('');
    setToast({ message: '', type: 'error' });
    try {
      const issues = validarCriacaoCondominio({ ...form, ...files });
      if (issues.length) throw new Error(issues[0]);

      await criarCondominio({ ...form, ...files }, session.user.id);
      await reloadMemberships();
      setFiles({
        logo: null,
        imagem_visao_geral: null,
        imagem_capa: null,
        imagem_login: null,
        imagens: [],
        documentos: [],
      });
      clearDraft();
      setConfirmOpen(false);
      setConfirmResumo(null);
      setCreating(false);
      setOk('Condomínio criado.');
      setToast({ message: 'Condomínio criado com sucesso.', type: 'ok' });
    } catch (err) {
      // Mantém o formulário e os arquivos; só fecha o confirm e avisa
      setConfirmOpen(false);
      const msg = err.message || 'Não foi possível criar o condomínio.';
      setError(msg);
      setToast({ message: msg, type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (!can(cargoTipo, 'create_condo')) {
    return (
      <div className="portal">
        <Alert error="Somente a Gestão Técnica acessa esta tela." />
      </div>
    );
  }

  return (
    <div className="portal">
      <GestaoBar />
      <Toast
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ message: '', type: 'error' })}
      />

      <main className="portal-main">
        <div className="portal-hero">
          <AppLogo className="portal-hero-logo" alt="CCA" />
          <div className="portal-toolbar">
            {!creating ? (
              <Btn
                icon="plus"
                className="btn-round"
                aria-label="Criar novo condomínio"
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
          <form className="stack" onSubmit={onSubmit} style={{ marginBottom: 24 }}>
            <Section title="Identificação">
              <Field label="Nome">
                <input value={form.nome} onChange={(e) => setField('nome', e.target.value)} required />
              </Field>
              <div className="grid grid-2">
                <Field label="CNPJ">
                  <input value={form.cnpj} onChange={(e) => setField('cnpj', e.target.value)} />
                </Field>
                <Field label="E-mail">
                  <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
                </Field>
              </div>
              <Field label="Descrição">
                <textarea value={form.descricao} onChange={(e) => setField('descricao', e.target.value)} />
              </Field>
            </Section>

            <Section title="Imagens de marca" hint="Arquivos opcionais. Ficam no Storage do condomínio.">
              <div className="grid grid-2">
                <Field label="Logo">
                  <input type="file" accept="image/png,image/webp,image/*" onChange={(e) => setFile('logo', e.target.files?.[0] || null)} />
                </Field>
                <Field label="Imagem visão geral">
                  <input type="file" accept="image/*" onChange={(e) => setFile('imagem_visao_geral', e.target.files?.[0] || null)} />
                </Field>
                <Field label="Imagem capa">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => setFile('imagem_capa', e.target.files?.[0] || null)}
                  />
                  <span className="hint">JPG, PNG ou WebP em alta resolução, até 20 MB. Só a capa fica em qualidade máxima.</span>
                </Field>
                <Field label="Imagem login">
                  <input type="file" accept="image/*" onChange={(e) => setFile('imagem_login', e.target.files?.[0] || null)} />
                </Field>
              </div>
            </Section>

            <Section title="Endereço">
              <div className="grid grid-2">
                <Field label="CEP">
                  <input value={form.cep} onChange={(e) => setField('cep', e.target.value)} />
                </Field>
                <Field label="Número">
                  <input value={form.numero} onChange={(e) => setField('numero', e.target.value)} />
                </Field>
              </div>
              <Field label="Logradouro">
                <input value={form.logradouro} onChange={(e) => setField('logradouro', e.target.value)} />
              </Field>
              <Field label="Complemento">
                <input value={form.complemento} onChange={(e) => setField('complemento', e.target.value)} />
              </Field>
              <div className="grid grid-3">
                <Field label="Bairro">
                  <input value={form.bairro} onChange={(e) => setField('bairro', e.target.value)} />
                </Field>
                <Field label="Cidade">
                  <input value={form.cidade} onChange={(e) => setField('cidade', e.target.value)} />
                </Field>
                <Field label="Estado">
                  <input value={form.estado} onChange={(e) => setField('estado', e.target.value)} />
                </Field>
              </div>
            </Section>

            <Section title="Boletim informativo">
              <Field label="Título">
                <input value={form.boletim_titulo} onChange={(e) => setField('boletim_titulo', e.target.value)} />
              </Field>
              <Field label="Texto">
                <textarea value={form.boletim_texto} onChange={(e) => setField('boletim_texto', e.target.value)} />
              </Field>
            </Section>

            <Section
              title="Fornecedores · Materiais · Locais · Garantias"
              hint="Copie o padrão, troque os [colchetes] pelos dados reais e cole de volta no campo. Uma linha = um registro."
            >
              <div className="row">
                <Btn
                  variant="ghost"
                  icon="copy"
                  onClick={async () => {
                    await copiarTexto(PADRAO_COMPLETO);
                    setOk('Todos os padrões de texto foram copiados.');
                    setError('');
                  }}
                >
                  Copiar todos os padrões
                </Btn>
              </div>
              <Field label="Base técnica (vínculos)">
                <p className="hint" style={{ marginTop: 0 }}>
                  Cada linha conecta Fornecedor · Material · Local · Garantia.
                  Ex.: <code>Acme | Porcelanato | Hall | Garantia fábrica</code>
                </p>
                <PadraoBar
                  padrao={PADROES.catalogo}
                  value={form.catalogo_texto}
                  onUse={(next) => setField('catalogo_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea
                  className="tall"
                  placeholder={PADROES.catalogo}
                  value={form.catalogo_texto}
                  onChange={(e) => setField('catalogo_texto', e.target.value)}
                />
              </Field>
              <Field label="Fornecedores">
                <p className="hint" style={{ marginTop: 0 }}>
                  Nome · CNPJ · vendedor · tel. vendedor · telefone 1 · telefone 2 · localização
                </p>
                <PadraoBar
                  padrao={PADROES.fornecedores}
                  value={form.fornecedores_texto}
                  onUse={(next) => setField('fornecedores_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.fornecedores} value={form.fornecedores_texto} onChange={(e) => setField('fornecedores_texto', e.target.value)} />
              </Field>
              <Field label="Materiais">
                <p className="hint" style={{ marginTop: 0 }}>
                  Um material por linha (nome). Vínculos com fornecedor/local/garantia vêm da base técnica.
                </p>
                <PadraoBar
                  padrao={PADROES.materiais}
                  value={form.materiais_texto}
                  onUse={(next) => setField('materiais_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.materiais} value={form.materiais_texto} onChange={(e) => setField('materiais_texto', e.target.value)} />
              </Field>
              <Field label="Locais">
                <p className="hint" style={{ marginTop: 0 }}>
                  Nome · descrição
                </p>
                <PadraoBar
                  padrao={PADROES.locais}
                  value={form.locais_texto}
                  onUse={(next) => setField('locais_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.locais} value={form.locais_texto} onChange={(e) => setField('locais_texto', e.target.value)} />
              </Field>
              <Field label="Garantias">
                <p className="hint" style={{ marginTop: 0 }}>
                  Nome · tempo · unidade (dias/meses/anos) · data final · perda da garantia · descrição · telefone
                </p>
                <PadraoBar
                  padrao={PADROES.garantias}
                  value={form.garantias_texto}
                  onUse={(next) => setField('garantias_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.garantias} value={form.garantias_texto} onChange={(e) => setField('garantias_texto', e.target.value)} />
              </Field>
            </Section>

            <Section
              title="Unidades do empreendimento"
              hint="Escolha se são casas ou prédios, quantas torres/blocos e como se chamam. As unidades são geradas automaticamente."
            >
              <UnidadesBuilder
                value={form.unidade_config}
                onChange={(next) => setField('unidade_config', next)}
              />
            </Section>

            <Section title="Documentos e imagens ilustrativas">
              <Field label="Documentos">
                <input type="file" multiple onChange={(e) => setFile('documentos', [...(e.target.files || [])])} />
              </Field>
              <Field label="Imagens ilustrativas do condomínio">
                <input type="file" accept="image/*" multiple onChange={(e) => setFile('imagens', [...(e.target.files || [])])} />
              </Field>
            </Section>

            <Btn type="submit" icon="check" disabled={busy}>
              {busy ? 'Criando…' : 'Criar condomínio'}
            </Btn>
          </form>
        ) : null}

        <Modal
          open={confirmOpen}
          title="Confirmar criação"
          onClose={() => {
            if (!busy) {
              setConfirmOpen(false);
              setConfirmResumo(null);
            }
          }}
          footer={(
            <>
              <Btn
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmResumo(null);
                }}
              >
                Revisar
              </Btn>
              <Btn icon="check" disabled={busy} onClick={confirmarCriacao}>
                {busy ? 'Criando…' : 'Confirmar e criar'}
              </Btn>
            </>
          )}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            Confira se está tudo certo. Só vamos enviar ao banco depois que você confirmar.
          </p>
          {confirmResumo ? (
            <ul className="confirm-resumo">
              <li><strong>Nome:</strong> {confirmResumo.nome}</li>
              {confirmResumo.cidade ? <li><strong>Cidade:</strong> {confirmResumo.cidade}</li> : null}
              <li><strong>Fornecedores:</strong> {confirmResumo.fornecedores}</li>
              <li><strong>Materiais:</strong> {confirmResumo.materiais}</li>
              <li><strong>Locais:</strong> {confirmResumo.locais}</li>
              <li><strong>Garantias:</strong> {confirmResumo.garantias}</li>
              <li><strong>Unidades:</strong> {confirmResumo.unidades}</li>
              <li><strong>Contatos:</strong> {confirmResumo.contatos}</li>
              <li><strong>Usuários a vincular:</strong> {confirmResumo.usuarios}</li>
              <li><strong>Linhas base técnica:</strong> {confirmResumo.linhasBase}</li>
              <li>
                <strong>Arquivos:</strong>{' '}
                {confirmResumo.arquivos.length ? confirmResumo.arquivos.join(', ') : 'nenhum'}
              </li>
            </ul>
          ) : null}
        </Modal>

        {!memberships.length && !creating ? (
          <div className="panel">
            <Empty text="Nenhum condomínio cadastrado. Clique em criar novo condomínio." />
          </div>
        ) : (
          <div className="condo-grid">
            {memberships.map((row) => {
              const nome = row.condominios?.nome || 'Condomínio';
              const loginUrl = loginUrlDoCondominio(row.condominio_id, nome);
              const dominioSalvo = row.condominios?.dominio || '';
              const dominioUrl = dominioUrlDoCondominio(dominioSalvo);
              const editing = editingDominioId === row.condominio_id;
              const saving = savingDominio === row.condominio_id;
              const unread = unreadByCondo[row.condominio_id] || 0;
              return (
                <article key={row.id} className={`condo-card${unread ? ' has-unread' : ''}`}>
                  {unread ? (
                    <UnreadOrb
                      count={unread}
                      variant="alerta"
                      title={`${unread} conversa(s) não visualizada(s) — abrir no Suporte`}
                      onClick={() => {
                        selectCondo(row.condominio_id);
                        navigate(`/suporte?condo=${row.condominio_id}&naoLidas=1`);
                      }}
                    />
                  ) : null}
                  <header className="condo-card-head">
                    <strong>{nome}</strong>
                    {row.condominios?.ativo === false ? <span className="condo-status">Inativo</span> : null}
                  </header>

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
                          placeholder="residencial-aurora.com.br"
                          autoFocus
                        />
                      </Field>
                      <div className="row">
                        <Btn icon="check" disabled={saving} onClick={() => salvarDominioDoCard(row)}>
                          {saving ? 'Salvando…' : 'Salvar'}
                        </Btn>
                        <Btn variant="ghost" icon="x" disabled={saving} onClick={fecharEditorDominio}>
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
                        onClick={() => abrirEditorDominio(row)}
                      >
                        Domínio
                      </Btn>
                    )}
                    <Btn
                      variant="ghost"
                      icon="plus"
                      onClick={() => {
                        setUsuariosModal({
                          open: true,
                          condoId: row.condominio_id,
                          nome: nome,
                        });
                      }}
                    >
                      Usuários
                    </Btn>
                    <Btn onClick={() => openCondo(row.condominio_id)}>
                      Abrir
                    </Btn>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <UsuariosGestaoModal
        open={usuariosModal.open}
        condoId={usuariosModal.condoId}
        condoNome={usuariosModal.nome}
        onClose={() => setUsuariosModal({ open: false, condoId: '', nome: '' })}
      />
    </div>
  );
}

export function CondominiosPage() {
  return <CondominiosPortal />;
}
