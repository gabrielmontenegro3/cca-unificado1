import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import {
  carregarConfigCondominio,
  carregarConfigConstrutora,
  listarConstrutoras,
  salvarConfigCondominio,
  salvarConfigConstrutora,
  trocarImagemCondominio,
  trocarLogoConstrutora,
} from '../lib/api';
import { loadBranding, loadBrandingConstrutora, nomeExibicaoConstrutora } from '../lib/branding';
import { formatCnpj } from '../lib/format';
import { GestaoBar } from '../components/GestaoBar';
import { Alert, Btn, Field, MaskedInput, Page } from '../components/ui';
import { Icon } from '../components/icons';

const IMAGENS_CONDOMINIO = [
  { tipo: 'capa', label: 'Foto de capa', hint: 'Aparece no topo do portal e no cartão do condomínio.', wide: true },
  { tipo: 'logo', label: 'Logo', hint: 'Use PNG com fundo transparente, se possível.' },
  { tipo: 'visao_geral', label: 'Imagem da visão geral', hint: 'Mostrada na tela Visão geral.' },
  { tipo: 'login', label: 'Imagem do login', hint: 'Fundo da tela de login do condomínio.' },
];

const BRAND_KEY = { capa: 'capa', logo: 'logo', visao_geral: 'visaoGeral', login: 'login' };

function useArquivoPreview(file) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) {
      setUrl('');
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function ImagemSlot({ label, hint, atual, file, onFile, wide = false, logo = false }) {
  const preview = useArquivoPreview(file);
  const src = preview || atual;
  return (
    <div className={`cfg-imagem${wide ? ' cfg-imagem--wide' : ''}${logo ? ' cfg-imagem--logo' : ''}`}>
      <span className="cfg-imagem-label">{label}</span>
      <label className="cfg-imagem-box">
        {src ? <img src={src} alt="" /> : (
          <span className="cfg-imagem-vazia">
            <Icon name="building" size={28} />
            Sem imagem
          </span>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => onFile(e.target.files?.[0] || null)}
        />
        <span className="cfg-imagem-acao">{src ? 'Trocar imagem' : 'Enviar imagem'}</span>
      </label>
      <small className="hint">
        {file ? `Nova imagem: ${file.name}` : hint}
        {file ? (
          <button type="button" className="cfg-imagem-desfazer" onClick={() => onFile(null)}>Desfazer</button>
        ) : null}
      </small>
    </div>
  );
}

function ConfigShell({ title, lead, children }) {
  const navigate = useNavigate();
  return (
    <div className="portal">
      <GestaoBar />
      <main className="portal-main wide">
        <Page
          className="cfg-page"
          title={title}
          lead={lead}
          actions={<Btn variant="ghost" icon="x" onClick={() => navigate(-1)}>Voltar</Btn>}
        >
          {children}
        </Page>
      </main>
    </div>
  );
}

export function ConfigCondominioPage() {
  const { id } = useParams();
  const { isAdminSistema, session, reloadMemberships } = useSession();
  const [form, setForm] = useState(null);
  const [marca, setMarca] = useState({});
  const [imagens, setImagens] = useState({});
  const [construtoras, setConstrutoras] = useState([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [{ condo, endereco }, brand, lista] = await Promise.all([
        carregarConfigCondominio(id),
        loadBranding(id),
        listarConstrutoras().catch(() => []),
      ]);
      setForm({
        nome: condo.nome || '',
        cnpj: condo.cnpj ? formatCnpj(condo.cnpj) || condo.cnpj : '',
        email: condo.email || '',
        descricao: condo.descricao || '',
        ativo: condo.ativo !== false,
        construtora_id: condo.construtora_id || '',
        construtora_id_original: condo.construtora_id || '',
        endereco_id: endereco?.id || '',
        cep: endereco?.cep || '',
        logradouro: endereco?.logradouro || '',
        numero: endereco?.numero || '',
        complemento: endereco?.complemento || '',
        bairro: endereco?.bairro || '',
        cidade: endereco?.cidade || '',
        estado: endereco?.estado || '',
      });
      setMarca(brand || {});
      setConstrutoras(lista || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Não foi possível carregar o condomínio.');
    }
  }

  useEffect(() => {
    if (isAdminSistema && id) load();
  }, [isAdminSistema, id]);

  if (!isAdminSistema) return <Navigate to="/" replace />;

  function setField(key, value) {
    setOk('');
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      await salvarConfigCondominio(id, form);
      for (const [tipo, file] of Object.entries(imagens)) {
        if (file) await trocarImagemCondominio({ condoId: id, userId: session?.user?.id, tipo, file });
      }
      setImagens({});
      await Promise.all([load(), reloadMemberships()]);
      setOk('Configurações do condomínio salvas.');
    } catch (err) {
      setError(err.message || 'Não foi possível salvar as configurações.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfigShell
      title={form?.nome ? `Configurações · ${form.nome}` : 'Configurações do condomínio'}
      lead="Dados gerais, endereço e imagens do condomínio. Somente o Administrador do sistema pode alterar."
    >
      <Alert error={error} ok={ok} />
      {!form ? (
        <p className="muted">{error ? '' : 'Carregando…'}</p>
      ) : (
        <form className="stack" onSubmit={onSubmit}>
          <section className="panel stack">
            <h2>Imagens</h2>
            <div className="cfg-imagens">
              {IMAGENS_CONDOMINIO.map((item) => (
                <ImagemSlot
                  key={item.tipo}
                  label={item.label}
                  hint={item.hint}
                  wide={item.wide}
                  logo={item.tipo === 'logo'}
                  atual={marca[BRAND_KEY[item.tipo]] || ''}
                  file={imagens[item.tipo] || null}
                  onFile={(file) => {
                    setOk('');
                    setImagens((prev) => ({ ...prev, [item.tipo]: file }));
                  }}
                />
              ))}
            </div>
          </section>

          <section className="panel stack">
            <h2>Dados gerais</h2>
            <Field label="Nome">
              <input value={form.nome} onChange={(e) => setField('nome', e.target.value)} required />
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
            <Field label="Construtora">
              <select value={form.construtora_id} onChange={(e) => setField('construtora_id', e.target.value)}>
                <option value="">Sem construtora</option>
                {construtoras.map((row) => (
                  <option key={row.id} value={row.id}>{nomeExibicaoConstrutora(row)}</option>
                ))}
              </select>
            </Field>
            <Field label="Descrição">
              <textarea value={form.descricao} onChange={(e) => setField('descricao', e.target.value)} rows={4} />
            </Field>
            <label className="cfg-check">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setField('ativo', e.target.checked)} />
              <span>Condomínio ativo</span>
            </label>
          </section>

          <section className="panel stack">
            <h2>Endereço</h2>
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
            <div className="grid grid-2">
              <Field label="Bairro">
                <input value={form.bairro} onChange={(e) => setField('bairro', e.target.value)} />
              </Field>
              <Field label="Cidade">
                <input value={form.cidade} onChange={(e) => setField('cidade', e.target.value)} />
              </Field>
            </div>
            <Field label="Estado">
              <input value={form.estado} onChange={(e) => setField('estado', e.target.value)} maxLength={30} />
            </Field>
          </section>

          <div className="cfg-footer">
            <Btn type="submit" icon="check" disabled={busy}>{busy ? 'Salvando…' : 'Salvar configurações'}</Btn>
          </div>
        </form>
      )}
    </ConfigShell>
  );
}

export function ConfigConstrutoraPage() {
  const { id } = useParams();
  const { isAdminSistema } = useSession();
  const [form, setForm] = useState(null);
  const [logoAtual, setLogoAtual] = useState('');
  const [logo, setLogo] = useState(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [row, brand] = await Promise.all([carregarConfigConstrutora(id), loadBrandingConstrutora(id)]);
      setForm({
        razao_social: row.razao_social || row.nome || '',
        nome_fantasia: row.nome_fantasia || row.nome || '',
        cnpj: row.cnpj ? formatCnpj(row.cnpj) || row.cnpj : '',
        email: row.email || '',
        descricao: row.descricao || '',
        ativo: row.ativo !== false,
      });
      setLogoAtual(brand?.logo || '');
      setError('');
    } catch (err) {
      setError(err.message || 'Não foi possível carregar a construtora.');
    }
  }

  useEffect(() => {
    if (isAdminSistema && id) load();
  }, [isAdminSistema, id]);

  if (!isAdminSistema) return <Navigate to="/" replace />;

  function setField(key, value) {
    setOk('');
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      await salvarConfigConstrutora(id, form);
      if (logo) await trocarLogoConstrutora(id, logo);
      setLogo(null);
      await load();
      setOk('Configurações da construtora salvas.');
    } catch (err) {
      setError(err.message || 'Não foi possível salvar as configurações.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfigShell
      title={form?.nome_fantasia ? `Configurações · ${form.nome_fantasia}` : 'Configurações da construtora'}
      lead="Dados gerais e logomarca da construtora. Somente o Administrador do sistema pode alterar."
    >
      <Alert error={error} ok={ok} />
      {!form ? (
        <p className="muted">{error ? '' : 'Carregando…'}</p>
      ) : (
        <form className="stack" onSubmit={onSubmit}>
          <section className="panel stack">
            <h2>Logomarca</h2>
            <div className="cfg-imagens">
              <ImagemSlot
                label="Logo"
                hint="Use PNG com fundo transparente, se possível."
                logo
                atual={logoAtual}
                file={logo}
                onFile={(file) => {
                  setOk('');
                  setLogo(file);
                }}
              />
            </div>
          </section>

          <section className="panel stack">
            <h2>Dados gerais</h2>
            <Field label="Razão social">
              <input value={form.razao_social} onChange={(e) => setField('razao_social', e.target.value)} required />
            </Field>
            <Field label="Nome fantasia">
              <input value={form.nome_fantasia} onChange={(e) => setField('nome_fantasia', e.target.value)} required />
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
              <textarea value={form.descricao} onChange={(e) => setField('descricao', e.target.value)} rows={4} />
            </Field>
            <label className="cfg-check">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setField('ativo', e.target.checked)} />
              <span>Construtora ativa</span>
            </label>
          </section>

          <div className="cfg-footer">
            <Btn type="submit" icon="check" disabled={busy}>{busy ? 'Salvando…' : 'Salvar configurações'}</Btn>
          </div>
        </form>
      )}
    </ConfigShell>
  );
}
