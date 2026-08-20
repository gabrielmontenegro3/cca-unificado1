import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { can } from '../lib/permissions';
import { criarCondominio } from '../lib/api';
import { GestaoBar } from '../components/GestaoBar';
import { Alert, Btn, Empty, Field } from '../components/ui';
import { PADROES, PADRAO_COMPLETO, copiarTexto } from '../lib/parseSeed';
import { loginUrlDoCondominio } from '../lib/branding';

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
  visao_geral: '',
  sobre_empreendimento: '',
  sobre_nos: '',
  assistencia_tecnica: '',
  boletim_titulo: '',
  boletim_texto: '',
  catalogo_texto: '',
  fornecedores_texto: '',
  materiais_texto: '',
  locais_texto: '',
  garantias_texto: '',
  unidades_texto: '',
  contatos_texto: '',
  usuarios_texto: '',
};

function PadraoBar({ padrao, value, onUse, onCopied }) {
  async function copy() {
    await copiarTexto(padrao);
    onCopied('Padrão copiado. Cole no campo, troque os [colchetes] pelos dados e salve.');
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
      return { ...EMPTY_FORM, ...(JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}').form || {}) };
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
  const [busy, setBusy] = useState(false);

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
    navigate('/painel');
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
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
      setOk('Condomínio criado.');
    } catch (err) {
      setError(err.message || 'Não foi possível criar o condomínio.');
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

      <main className="portal-main">
        <div className="page-head">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h1>Condomínios</h1>
              <p>Selecione um empreendimento, copie o link da tela de login ou cadastre um novo.</p>
            </div>
            {!creating ? (
              <Btn icon="plus" onClick={() => setCreating(true)}>
                Criar novo condomínio
              </Btn>
            ) : (
              <Btn variant="ghost" icon="x" onClick={() => setCreating(false)}>
                Cancelar
              </Btn>
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
                  <input type="file" accept="image/*" onChange={(e) => setFile('logo', e.target.files?.[0] || null)} />
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

            <Section title="Conteúdo institucional" hint="Textos livres. Cada bloco vira uma seção nas telas do condomínio.">
              <Field label="Visão geral">
                <textarea value={form.visao_geral} onChange={(e) => setField('visao_geral', e.target.value)} />
              </Field>
              <Field label="Sobre o empreendimento">
                <textarea value={form.sobre_empreendimento} onChange={(e) => setField('sobre_empreendimento', e.target.value)} />
              </Field>
              <Field label="Sobre nós">
                <textarea value={form.sobre_nos} onChange={(e) => setField('sobre_nos', e.target.value)} />
              </Field>
              <Field label="Assistência técnica">
                <textarea value={form.assistencia_tecnica} onChange={(e) => setField('assistencia_tecnica', e.target.value)} />
              </Field>
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
              title="Fornecedores | Material | Local | Garantia"
              hint="Copie o padrão do sistema, preencha no lugar dos [colchetes] e cole de volta. A primeira linha (cabeçalho) é lida e ignorada."
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
              <Field label="Base técnica (texto)">
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
                <PadraoBar
                  padrao={PADROES.fornecedores}
                  value={form.fornecedores_texto}
                  onUse={(next) => setField('fornecedores_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.fornecedores} value={form.fornecedores_texto} onChange={(e) => setField('fornecedores_texto', e.target.value)} />
              </Field>
              <Field label="Materiais">
                <PadraoBar
                  padrao={PADROES.materiais}
                  value={form.materiais_texto}
                  onUse={(next) => setField('materiais_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.materiais} value={form.materiais_texto} onChange={(e) => setField('materiais_texto', e.target.value)} />
              </Field>
              <Field label="Locais">
                <PadraoBar
                  padrao={PADROES.locais}
                  value={form.locais_texto}
                  onUse={(next) => setField('locais_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.locais} value={form.locais_texto} onChange={(e) => setField('locais_texto', e.target.value)} />
              </Field>
              <Field label="Garantias">
                <PadraoBar
                  padrao={PADROES.garantias}
                  value={form.garantias_texto}
                  onUse={(next) => setField('garantias_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.garantias} value={form.garantias_texto} onChange={(e) => setField('garantias_texto', e.target.value)} />
              </Field>
            </Section>

            <Section title="Unidades, contatos e usuários" hint="Mesmo padrão: copie, preencha e mantenha o cabeçalho. Cargo: administrador, construtora, administracao ou morador. Só vincula quem já tem login no Auth.">
              <Field label="Unidades">
                <PadraoBar
                  padrao={PADROES.unidades}
                  value={form.unidades_texto}
                  onUse={(next) => setField('unidades_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.unidades} value={form.unidades_texto} onChange={(e) => setField('unidades_texto', e.target.value)} />
              </Field>
              <Field label="Contatos">
                <PadraoBar
                  padrao={PADROES.contatos}
                  value={form.contatos_texto}
                  onUse={(next) => setField('contatos_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.contatos} value={form.contatos_texto} onChange={(e) => setField('contatos_texto', e.target.value)} />
              </Field>
              <Field label="Usuários">
                <PadraoBar
                  padrao={PADROES.usuarios}
                  value={form.usuarios_texto}
                  onUse={(next) => setField('usuarios_texto', next)}
                  onCopied={(msg) => { setOk(msg); setError(''); }}
                />
                <textarea className="tall" placeholder={PADROES.usuarios} value={form.usuarios_texto} onChange={(e) => setField('usuarios_texto', e.target.value)} />
              </Field>
            </Section>

            <Section title="Documentos e imagens ilustrativas">
              <Field label="Documentos">
                <input type="file" multiple onChange={(e) => setFile('documentos', [...(e.target.files || [])])} />
              </Field>
              <Field label="Imagens ilustrativas do condomínio">
                <input type="file" accept="image/*" multiple onChange={(e) => setFile('imagens', [...(e.target.files || [])])} />
              </Field>
            </Section>

            <Section title="Chamados, laudos e chat">
              <p className="hint">
                Chamado, número do registro, status, mensagens, imagens/documentos, laudo técnico e o chat
                são gerados automaticamente quando alguém abre um registro no condomínio. Não se preenche na criação.
              </p>
            </Section>

            <Btn type="submit" icon="check" disabled={busy}>
              {busy ? 'Criando…' : 'Salvar condomínio'}
            </Btn>
          </form>
        ) : null}

        {!memberships.length && !creating ? (
          <div className="panel">
            <Empty text="Nenhum condomínio cadastrado. Clique em criar novo condomínio." />
          </div>
        ) : (
          <div className="condo-grid">
            {memberships.map((row) => {
              const loginUrl = loginUrlDoCondominio(row.condominio_id);
              return (
                <article key={row.id} className="condo-card">
                  <strong>{row.condominios?.nome || 'Condomínio'}</strong>
                  <small>{row.condominios?.ativo === false ? 'Inativo' : 'Tela de login deste condomínio'}</small>
                  <p className="condo-login-url">{loginUrl}</p>
                  <div className="row">
                    <Btn
                      variant="ghost"
                      icon="copy"
                      onClick={async () => {
                        await copiarTexto(loginUrl);
                        setOk(`Link de login copiado: ${row.condominios?.nome || 'condomínio'}`);
                        setError('');
                      }}
                    >
                      Copiar login
                    </Btn>
                    <Btn icon="building" onClick={() => openCondo(row.condominio_id)}>
                      Abrir
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

export function CondominiosPage() {
  return <CondominiosPortal />;
}
