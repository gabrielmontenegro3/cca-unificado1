import { useEffect, useMemo, useRef, useState } from 'react';
import { useArrastarOrdenar } from '../lib/useArrastarOrdenar';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { publicOrSignedUrl, uploadArquivo } from '../lib/api';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { Modal } from '../components/DataList';
import { Icon } from '../components/icons';
import { ArquivoPreviewCard } from '../components/ArquivoPreview';

const SQL_MATERIAIS = 'supabase/materiais-unificado.sql';
const SQL_ARQUIVOS = 'supabase/arquivos-topo-multiplos.sql';
const TELA_DOCS = 'materiais';
const CAMPOS_ARQUIVO = 'id, nome_original, storage_path, mime_type, tipo, tamanho_bytes';

function mensagemErro(err) {
  const msg = String(err?.message || err || '');
  if (/especificacoes|fornecedores_nomes|materiais\.garantia|column .*garantia/i.test(msg)) {
    return `Rode o arquivo ${SQL_MATERIAIS} no SQL Editor do Supabase e tente de novo.`;
  }
  if (/catalogo_arquivos_principais\.(id|ordem)|duplicate key|23505/i.test(msg) || err?.code === '23505') {
    return `Rode o arquivo ${SQL_ARQUIVOS} no SQL Editor do Supabase e tente de novo.`;
  }
  if (err?.code === '23503') return 'Este produto ainda está ligado a outro cadastro e não pôde ser excluído.';
  return msg || 'Não foi possível concluir.';
}

function limparFornecedores(lista) {
  const vistos = new Set();
  return (lista || [])
    .map((nome) => String(nome || '').trim())
    .filter((nome) => {
      const chave = nome.toLocaleLowerCase('pt-BR');
      if (!nome || vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
}

/* =========================================================
   Documentos do topo: vários arquivos, arrastar para ordenar
   ========================================================= */


/** Espera a animação terminar, mas nunca trava (aba em segundo plano pausa as animações). */
function aguardarAnimacao(animacao, limite) {
  return Promise.race([
    animacao.finished.catch(() => {}),
    new Promise((resolve) => { setTimeout(resolve, limite); }),
  ]);
}

function DocumentosTopo({ condoId, userId, editable }) {
  const [docs, setDocs] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [confirmarId, setConfirmarId] = useState('');

  async function load() {
    if (!condoId) return;
    const { data, error: err } = await supabase
      .from('catalogo_arquivos_principais')
      .select(`id, ordem, arquivos(${CAMPOS_ARQUIVO})`)
      .eq('condominio_id', condoId)
      .eq('tela', TELA_DOCS)
      .order('ordem')
      .order('created_at');
    if (err) {
      setError(mensagemErro(err));
      return;
    }
    const lista = await Promise.all((data || []).map(async (row) => {
      const arquivo = Array.isArray(row.arquivos) ? row.arquivos[0] : row.arquivos;
      if (!arquivo?.storage_path) return null;
      const { data: assinado } = await publicOrSignedUrl(arquivo.storage_path);
      return { ...arquivo, vinculoId: row.id, ordem: row.ordem || 0, url: assinado?.signedUrl || '' };
    }));
    setDocs(lista.filter(Boolean));
    setError('');
  }

  useEffect(() => { load(); }, [condoId]);
  async function anexar(e) {
    e.preventDefault();
    if (!files.length) return;
    setBusy(true);
    setError('');
    setOk('');
    try {
      let proxima = docs.reduce((max, d) => Math.max(max, (d.ordem || 0) + 1), 0);
      for (const file of files) {
        const arquivo = await uploadArquivo({ condominioId: condoId, userId, file, folder: 'catalogo/materiais' });
        const { error: err } = await supabase.from('catalogo_arquivos_principais').insert({
          condominio_id: condoId,
          tela: TELA_DOCS,
          arquivo_id: arquivo.id,
          ordem: proxima,
          updated_at: new Date().toISOString(),
        });
        if (err) {
          await supabase.from('arquivos').delete().eq('id', arquivo.id);
          throw err;
        }
        proxima += 1;
      }
      setFiles([]);
      setFileKey((v) => v + 1);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function excluir(doc) {
    setBusy(true);
    setError('');
    setOk('');
    try {
      const { error: err } = await supabase.from('catalogo_arquivos_principais').delete().eq('id', doc.vinculoId);
      if (err) throw err;
      await supabase.from('arquivos').delete().eq('id', doc.id);
      // O cartão encolhe e some antes de sair da lista.
      const el = document.querySelector(`[data-arr-id="${doc.vinculoId}"]`);
      if (el) {
        await aguardarAnimacao(el.animate(
          [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.85)' }],
          { duration: 200, easing: 'ease-in', fill: 'forwards' },
        ), 260);
      }
      prepararAnimacao();
      setDocs((atual) => atual.filter((d) => d.vinculoId !== doc.vinculoId));
      setConfirmarId('');
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function salvarOrdem(lista, anterior) {
    const mudaram = lista.map((d, ordem) => ({ d, ordem })).filter(({ d, ordem }) => anterior[ordem] !== d.vinculoId);
    if (!mudaram.length) return;
    setOk('');
    const resultados = await Promise.all(mudaram.map(({ d, ordem }) => supabase
      .from('catalogo_arquivos_principais').update({ ordem }).eq('id', d.vinculoId)));
    const falha = resultados.find((r) => r.error);
    if (falha) {
      setError(mensagemErro(falha.error));
      await load();
      return;
    }
    setDocs((atual) => atual.map((d, i) => ({ ...d, ordem: i })));
    setOk('Ordem dos documentos salva.');
  }

  // Arrastar e soltar seguro (sem duplicar), comum às telas com documentos.
  const { arrastandoId, propsItem, prepararAnimacao } = useArrastarOrdenar({
    itens: docs,
    setItens: setDocs,
    getId: (doc) => doc.vinculoId,
    ativo: editable && docs.length > 1 && !busy,
    onSoltar: (lista, idsAntes) => salvarOrdem(lista, idsAntes),
  });

  if (!docs.length && !editable) return null;

  return (
    <section className="mat-docs">
      <header className="mat-docs-head">
        <div>
          <h2>Documentos</h2>
          {editable && docs.length > 1 ? <p>Segure um documento e arraste para mudar a ordem.</p> : null}
        </div>
        {editable ? (
          <form className="mat-docs-form" onSubmit={anexar}>
            <input key={fileKey} type="file" multiple onChange={(e) => setFiles([...(e.target.files || [])])} />
            <Btn type="submit" icon="paperclip" disabled={busy || !files.length}>
              {busy ? 'Anexando…' : docs.length ? 'Adicionar' : 'Anexar'}
            </Btn>
          </form>
        ) : null}
      </header>
      <Alert error={error} ok={ok} />
      {docs.length ? (
        <ul className="mat-docs-grid">
          {docs.map((doc) => (
            <li
              key={doc.vinculoId}
              className={[
                'mat-doc',
                editable && docs.length > 1 ? 'is-sortable' : '',
                arrastandoId === doc.vinculoId ? 'is-placeholder' : '',
              ].filter(Boolean).join(' ')}
              {...propsItem(doc)}
            >
              <ArquivoPreviewCard
                arquivo={doc}
                url={doc.url}
                compact
                actions={editable ? (
                  confirmarId === doc.vinculoId ? (
                    <span className="mat-confirm">
                      <span>Excluir?</span>
                      <button type="button" className="is-yes" disabled={busy} onClick={() => excluir(doc)}>Sim</button>
                      <button type="button" disabled={busy} onClick={() => setConfirmarId('')}>Não</button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="arquivo-preview-btn arquivo-preview-btn--ghost"
                      disabled={busy}
                      onClick={() => setConfirmarId(doc.vinculoId)}
                      aria-label={`Excluir ${doc.nome_original || 'documento'}`}
                      title="Excluir"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  )
                ) : null}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mat-vazio">Nenhum documento anexado. Use “Anexar” para colocar os documentos que abrem esta tela.</p>
      )}
    </section>
  );
}

/* =========================================================
   Formulário do produto (criar e editar)
   ========================================================= */

const UNIDADES_PRAZO = [
  { id: 'dias', label: 'dias', um: 'dia' },
  { id: 'meses', label: 'meses', um: 'mês' },
  { id: 'anos', label: 'anos', um: 'ano' },
];

const PRODUTO_VAZIO = {
  nome: '',
  fornecedores: [''],
  especificacoes: '',
  prazoValor: '',
  prazoUnidade: 'anos',
  descricaoGarantia: '',
  perdaGarantia: '',
  localIds: [],
};

function textoPrazo(valor, unidade) {
  if (valor === '' || valor == null) return '';
  const n = Number(valor);
  const u = UNIDADES_PRAZO.find((item) => item.id === unidade) || UNIDADES_PRAZO[2];
  return `${valor} ${n === 1 ? u.um : u.label}`;
}

function FormProduto({ id, valor, locais, onChange, onSubmit }) {
  const fornecedores = valor.fornecedores.length ? valor.fornecedores : [''];
  const refs = useRef([]);
  const focarUltimo = useRef(false);

  useEffect(() => {
    if (!focarUltimo.current) return;
    focarUltimo.current = false;
    refs.current[fornecedores.length - 1]?.focus();
  }, [fornecedores.length]);

  function mudarFornecedor(i, nome) {
    const lista = fornecedores.slice();
    lista[i] = nome;
    onChange({ ...valor, fornecedores: lista });
  }

  function adicionarFornecedor() {
    focarUltimo.current = true;
    onChange({ ...valor, fornecedores: [...fornecedores, ''] });
  }

  function removerFornecedor(i) {
    const lista = fornecedores.filter((_, j) => j !== i);
    onChange({ ...valor, fornecedores: lista.length ? lista : [''] });
  }

  function alternarLocal(localId) {
    const marcado = valor.localIds.includes(localId);
    onChange({
      ...valor,
      localIds: marcado ? valor.localIds.filter((x) => x !== localId) : [...valor.localIds, localId],
    });
  }

  return (
    <form id={id} className="stack mat-form" onSubmit={onSubmit}>
      <Field label="Nome do produto">
        <input
          value={valor.nome}
          onChange={(e) => onChange({ ...valor, nome: e.target.value })}
          placeholder="Ex.: Porcelanato 60x60 acetinado"
          required
        />
      </Field>

      <div className="field mat-fornecedores">
        <span>{fornecedores.length > 1 ? 'Fornecedores' : 'Fornecedor'}</span>
        <ul>
          {fornecedores.map((nome, i) => (
            <li key={i}>
              <input
                ref={(el) => { refs.current[i] = el; }}
                value={nome}
                onChange={(e) => mudarFornecedor(i, e.target.value)}
                placeholder={i === 0 ? 'Ex.: Portobello' : 'Outro fornecedor'}
                aria-label={`Fornecedor ${i + 1}`}
              />
              {fornecedores.length > 1 ? (
                <button type="button" className="mat-icon-btn" onClick={() => removerFornecedor(i)} aria-label={`Remover fornecedor ${i + 1}`} title="Remover">
                  <Icon name="x" size={15} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <button type="button" className="mat-add-fornecedor" onClick={adicionarFornecedor}>
          <Icon name="plus" size={15} />
          Adicionar fornecedor
        </button>
      </div>

      <Field label="Especificações">
        <textarea
          value={valor.especificacoes}
          rows={3}
          onChange={(e) => onChange({ ...valor, especificacoes: e.target.value })}
          placeholder="Modelo, dimensões, cor, acabamento…"
        />
      </Field>

      <fieldset className="mat-fieldset">
        <legend><Icon name="shield" size={14} /> Garantia</legend>
        <div className="field mat-prazo">
          <span>Tempo de garantia</span>
          <div className="mat-prazo-linha">
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={valor.prazoValor}
              onChange={(e) => onChange({ ...valor, prazoValor: e.target.value })}
              placeholder="Ex.: 5"
              aria-label="Tempo de garantia"
            />
            <select
              value={valor.prazoUnidade}
              onChange={(e) => onChange({ ...valor, prazoUnidade: e.target.value })}
              aria-label="Unidade do tempo"
            >
              {UNIDADES_PRAZO.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </div>
        </div>
        <Field label="Descrição da garantia">
          <textarea
            value={valor.descricaoGarantia}
            rows={2}
            onChange={(e) => onChange({ ...valor, descricaoGarantia: e.target.value })}
            placeholder="O que a garantia cobre. Ex.: defeitos de fabricação e desgaste anormal"
          />
        </Field>
        <Field label="Perda da garantia">
          <textarea
            value={valor.perdaGarantia}
            rows={2}
            onChange={(e) => onChange({ ...valor, perdaGarantia: e.target.value })}
            placeholder="Casos em que a garantia é perdida. Ex.: uso de produtos abrasivos"
          />
        </Field>
      </fieldset>

      <div className="field mat-locais">
        <span>Locais</span>
        {locais.length ? (
          <div className="mat-locais-opcoes" role="group" aria-label="Locais do produto">
            {locais.map((local) => {
              const marcado = valor.localIds.includes(local.id);
              return (
                <button
                  key={local.id}
                  type="button"
                  className={`mat-local-opcao${marcado ? ' is-on' : ''}`}
                  aria-pressed={marcado}
                  onClick={() => alternarLocal(local.id)}
                >
                  {marcado ? <Icon name="check" size={13} /> : <Icon name="map" size={13} />}
                  {local.nome}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mat-vazio">Nenhum local cadastrado. Cadastre na tela Locais.</p>
        )}
      </div>
    </form>
  );
}

/* =========================================================
   Lista de produtos
   ========================================================= */

/** Uma linha por produto: nome, fornecedores, locais e prazo. Clique abre a visualização. */
function LinhaProduto({ produto, locaisPorId, editable, onAbrir, onEditar, onExcluir }) {
  const prazo = textoPrazo(produto.prazoValor, produto.prazoUnidade);
  const locaisNomes = produto.localIds.map((idLocal) => locaisPorId.get(idLocal)).filter(Boolean);
  const parar = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <li
      className="mat-linha"
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir(); } }}
      aria-label={`Ver ${produto.nome}`}
    >
      <span className="mat-card-icon" aria-hidden="true"><Icon name="layers" size={17} /></span>
      <strong className="mat-linha-nome" title={produto.nome}>{produto.nome}</strong>
      <span className="mat-linha-info" title={[produto.fornecedores.join(', '), locaisNomes.join(', ')].filter(Boolean).join(' · ')}>
        {produto.fornecedores.length ? (
          <span className="mat-linha-fornecedores">{produto.fornecedores.join(' · ')}</span>
        ) : <span className="mat-vazio">Sem fornecedor</span>}
        {locaisNomes.length ? (
          <span className="mat-linha-locais">
            <Icon name="map" size={12} />
            {locaisNomes.length === 1 ? locaisNomes[0] : `${locaisNomes.length} locais`}
          </span>
        ) : null}
      </span>
      <span className={`mat-prazo-badge${prazo ? '' : ' is-vazio'}`} title="Tempo de garantia">
        <Icon name="shield" size={13} />
        {prazo || 'Sem prazo'}
      </span>
      {editable ? (
        <span className="mat-card-acoes">
          <button type="button" className="mat-icon-btn" onClick={parar(onEditar)} aria-label={`Editar ${produto.nome}`} title="Editar">
            <Icon name="pencil" size={15} />
          </button>
          <button type="button" className="mat-icon-btn is-danger" onClick={parar(onExcluir)} aria-label={`Excluir ${produto.nome}`} title="Excluir">
            <Icon name="trash" size={15} />
          </button>
        </span>
      ) : (
        <Icon name="chevron" size={16} className="mat-linha-seta" />
      )}
    </li>
  );
}

/** Visualização completa do produto (mesmo modelo de janela usado antes no catálogo). */
function VisualizacaoProduto({ produto, locaisPorId }) {
  const prazo = textoPrazo(produto.prazoValor, produto.prazoUnidade);
  const locaisNomes = produto.localIds.map((idLocal) => locaisPorId.get(idLocal)).filter(Boolean);
  const campos = [
    { label: 'Nome do produto', value: produto.nome },
    { label: produto.fornecedores.length > 1 ? 'Fornecedores' : 'Fornecedor', value: produto.fornecedores.join(', ') },
    { label: 'Especificações', value: produto.especificacoes },
    { label: 'Tempo de garantia', value: prazo },
    { label: 'Descrição da garantia', value: produto.descricaoGarantia },
    { label: 'Perda da garantia', value: produto.perdaGarantia },
    { label: 'Locais', value: locaisNomes.join(', ') },
  ];
  return (
    <div className="catalog-detail mat-detalhe">
      <div className="local-detail-icon" aria-hidden="true">
        <Icon name="layers" size={32} />
      </div>
      <dl className="catalog-detail-fields">
        {campos.map((item) => (
          <div key={item.label} className="catalog-detail-field">
            <dt>{item.label}</dt>
            <dd>{item.value ? item.value : '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* =========================================================
   Tela
   ========================================================= */

const ERRO_TABELA_AUSENTE = /does not exist|schema cache|PGRST20/i;

export function MateriaisPage() {
  const { condoId, session } = useSession();
  const { editable, editing, showEditButton, canRole, toggleEditing } = useEditTela('manage_catalog');
  const [produtos, setProdutos] = useState([]);
  const [locais, setLocais] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [modoAntigo, setModoAntigo] = useState(false);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [novo, setNovo] = useState(PRODUTO_VAZIO);
  const [edicao, setEdicao] = useState(null);
  const [exclusao, setExclusao] = useState(null);
  const [vendoId, setVendoId] = useState('');
  const vendo = vendoId ? produtos.find((p) => p.id === vendoId) || null : null;

  const locaisPorId = useMemo(() => new Map(locais.map((l) => [l.id, l.nome])), [locais]);

  async function load() {
    if (!condoId) return;
    const camposBase = 'id, nome, prazo_valor, prazo_unidade, descricao, motivos_perda_garantia, created_at';
    let { data, error: err } = await supabase
      .from('materiais')
      .select(`${camposBase}, especificacoes, garantia, fornecedores_nomes`)
      .eq('condominio_id', condoId)
      .order('created_at')
      .order('nome');
    let antigo = false;
    if (err && /especificacoes|garantia|fornecedores_nomes|column/i.test(String(err.message || ''))) {
      antigo = true;
      ({ data, error: err } = await supabase
        .from('materiais')
        .select(`${camposBase}, fornecedores:fornecedor_id(nome)`)
        .eq('condominio_id', condoId)
        .order('created_at'));
    }
    if (err) {
      setError(mensagemErro(err));
      setCarregado(true);
      return;
    }
    const ids = (data || []).map((row) => row.id);
    const [vinculos, listaLocais] = await Promise.all([
      ids.length
        ? supabase.from('material_locais').select('material_id, local_id').in('material_id', ids)
        : Promise.resolve({ data: [] }),
      supabase.from('locais').select('id, nome').eq('condominio_id', condoId).order('nome'),
    ]);
    const locaisDe = {};
    for (const v of vinculos.data || []) (locaisDe[v.material_id] ||= []).push(v.local_id);
    setLocais(listaLocais.data || []);
    setModoAntigo(antigo);
    setProdutos((data || []).map((row) => ({
      id: row.id,
      nome: row.nome,
      fornecedores: antigo
        ? (row.fornecedores?.nome ? [row.fornecedores.nome] : [])
        : limparFornecedores(row.fornecedores_nomes),
      especificacoes: row.especificacoes || '',
      prazoValor: row.prazo_valor == null ? '' : String(row.prazo_valor),
      prazoUnidade: UNIDADES_PRAZO.some((u) => u.id === row.prazo_unidade) ? row.prazo_unidade : 'anos',
      // Produtos salvos só com o texto livre de garantia mostram esse texto como descrição.
      descricaoGarantia: row.descricao || (!row.prazo_valor && !row.motivos_perda_garantia ? row.garantia || '' : ''),
      perdaGarantia: row.motivos_perda_garantia || '',
      localIds: locaisDe[row.id] || [],
    })));
    setError('');
    setCarregado(true);
  }

  useEffect(() => { load(); }, [condoId]);

  const visiveis = useMemo(() => {
    const termo = q.trim().toLocaleLowerCase('pt-BR');
    if (!termo) return produtos;
    return produtos.filter((p) => [
      p.nome, p.fornecedores.join(' '), p.especificacoes, p.descricaoGarantia, p.perdaGarantia,
      p.localIds.map((idLocal) => locaisPorId.get(idLocal) || '').join(' '),
    ].join(' ').toLocaleLowerCase('pt-BR').includes(termo));
  }, [produtos, q, locaisPorId]);

  function validar(valor) {
    if (!valor.nome.trim()) return 'Informe o nome do produto.';
    if (valor.prazoValor !== '' && (Number.isNaN(Number(valor.prazoValor)) || Number(valor.prazoValor) < 0)) {
      return 'Informe um tempo de garantia válido.';
    }
    if (modoAntigo) return `Rode o arquivo ${SQL_MATERIAIS} no SQL Editor do Supabase e tente de novo.`;
    return '';
  }

  function payload(valor) {
    const temPrazo = valor.prazoValor !== '';
    return {
      nome: valor.nome.trim(),
      fornecedores_nomes: limparFornecedores(valor.fornecedores),
      especificacoes: valor.especificacoes.trim() || null,
      prazo_valor: temPrazo ? Number(valor.prazoValor) : null,
      prazo_unidade: temPrazo ? valor.prazoUnidade : null,
      descricao: valor.descricaoGarantia.trim() || null,
      motivos_perda_garantia: valor.perdaGarantia.trim() || null,
      // O texto único de garantia foi substituído pelos três campos acima.
      garantia: null,
    };
  }

  async function salvarLocais(materialId, desejados, atuais) {
    const remover = atuais.filter((x) => !desejados.includes(x));
    const incluir = desejados.filter((x) => !atuais.includes(x));
    if (remover.length) {
      const { error: err } = await supabase.from('material_locais').delete().eq('material_id', materialId).in('local_id', remover);
      if (err) throw err;
    }
    if (incluir.length) {
      const { error: err } = await supabase.from('material_locais').insert(incluir.map((localId) => ({ material_id: materialId, local_id: localId })));
      if (err) throw err;
    }
  }

  async function criar(e) {
    e.preventDefault();
    const problema = validar(novo);
    if (problema) return setError(problema);
    setBusy(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('materiais')
        .insert({ condominio_id: condoId, ...payload(novo) })
        .select('id')
        .single();
      if (err) throw err;
      if (novo.localIds.length) await salvarLocais(data.id, novo.localIds, []);
      setNovo(PRODUTO_VAZIO);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function salvarEdicao(e) {
    e.preventDefault();
    if (!edicao) return;
    const problema = validar(edicao.valor);
    if (problema) return setError(problema);
    setBusy(true);
    setError('');
    try {
      const { error: err } = await supabase.from('materiais').update(payload(edicao.valor)).eq('id', edicao.id);
      if (err) throw err;
      await salvarLocais(edicao.id, edicao.valor.localIds, edicao.localIdsOriginais);
      setEdicao(null);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function excluir() {
    if (!exclusao) return;
    setBusy(true);
    setError('');
    try {
      // Vínculos do material (locais e garantias antigas) saem antes.
      for (const tabela of ['material_locais', 'material_garantias']) {
        const { error: err } = await supabase.from(tabela).delete().eq('material_id', exclusao.id);
        if (err && !ERRO_TABELA_AUSENTE.test(String(err.message || ''))) throw err;
      }
      const { error: err } = await supabase.from('materiais').delete().eq('id', exclusao.id);
      if (err) throw err;
      setExclusao(null);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Materiais"
      lead="Produtos do empreendimento com fornecedores, especificações, garantia e locais."
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
      search={{ value: q, onChange: setQ, placeholder: 'Pesquisar produto, fornecedor, local ou garantia…' }}
    >
      <Alert error={!edicao && !exclusao ? error : ''} />
      {modoAntigo && canRole ? (
        <p className="hint">Para gravar fornecedores e especificações, rode {SQL_MATERIAIS} no SQL Editor do Supabase.</p>
      ) : null}

      <DocumentosTopo condoId={condoId} userId={session?.user?.id} editable={editable} />

      <div className="mat-lista-head">
        <h2>Produtos</h2>
        <span className="mat-contagem">{produtos.length}</span>
      </div>

      {carregado && !visiveis.length ? (
        <Empty text={q ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.'} />
      ) : (
        <ul className="mat-lista">
          {visiveis.map((produto) => (
            <LinhaProduto
              key={produto.id}
              produto={produto}
              locaisPorId={locaisPorId}
              editable={editable}
              onAbrir={() => setVendoId(produto.id)}
              onEditar={() => {
                setError('');
                setEdicao({
                  id: produto.id,
                  localIdsOriginais: produto.localIds,
                  valor: {
                    nome: produto.nome || '',
                    fornecedores: produto.fornecedores.length ? produto.fornecedores : [''],
                    especificacoes: produto.especificacoes,
                    prazoValor: produto.prazoValor,
                    prazoUnidade: produto.prazoUnidade,
                    descricaoGarantia: produto.descricaoGarantia,
                    perdaGarantia: produto.perdaGarantia,
                    localIds: produto.localIds,
                  },
                });
              }}
              onExcluir={() => { setError(''); setExclusao(produto); }}
            />
          ))}
        </ul>
      )}

      {editable ? (
        <section className="panel mat-novo">
          <h2>Novo produto</h2>
          <FormProduto id="mat-novo" valor={novo} locais={locais} onChange={setNovo} onSubmit={criar} />
          <div className="mat-novo-acoes">
            <Btn type="submit" form="mat-novo" icon="check" disabled={busy}>{busy ? 'Salvando…' : 'Salvar produto'}</Btn>
          </div>
        </section>
      ) : !canRole ? (
        <p className="hint" style={{ marginTop: 16 }}>Somente leitura. A Gestão Técnica e o administrador cadastram os produtos.</p>
      ) : null}

      <Modal
        open={Boolean(vendo) && !edicao && !exclusao}
        title={vendo?.nome || 'Produto'}
        className="modal-sheet--catalog mat-modal"
        onClose={() => setVendoId('')}
        footer={editable && vendo ? (
          <>
            <Btn variant="danger" icon="trash" onClick={() => { setError(''); setExclusao(vendo); setVendoId(''); }}>Excluir</Btn>
            <Btn icon="pencil" onClick={() => {
              setError('');
              setEdicao({
                id: vendo.id,
                localIdsOriginais: vendo.localIds,
                valor: {
                  nome: vendo.nome || '',
                  fornecedores: vendo.fornecedores.length ? vendo.fornecedores : [''],
                  especificacoes: vendo.especificacoes,
                  prazoValor: vendo.prazoValor,
                  prazoUnidade: vendo.prazoUnidade,
                  descricaoGarantia: vendo.descricaoGarantia,
                  perdaGarantia: vendo.perdaGarantia,
                  localIds: vendo.localIds,
                },
              });
              setVendoId('');
            }}
            >
              Editar
            </Btn>
          </>
        ) : null}
      >
        {vendo ? <VisualizacaoProduto produto={vendo} locaisPorId={locaisPorId} /> : null}
      </Modal>

      <Modal
        open={Boolean(edicao)}
        title={edicao ? `Editar ${edicao.valor.nome || 'produto'}` : 'Editar produto'}
        className="modal-sheet--wide mat-modal"
        onClose={() => !busy && setEdicao(null)}
        footer={(
          <>
            <Btn variant="ghost" onClick={() => setEdicao(null)} disabled={busy}>Cancelar</Btn>
            <Btn type="submit" form="mat-editar" icon="check" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</Btn>
          </>
        )}
      >
        <Alert error={edicao ? error : ''} />
        {edicao ? (
          <FormProduto
            id="mat-editar"
            valor={edicao.valor}
            locais={locais}
            onChange={(valor) => setEdicao({ ...edicao, valor })}
            onSubmit={salvarEdicao}
          />
        ) : null}
      </Modal>

      <Modal
        open={Boolean(exclusao)}
        title="Excluir produto"
        className="mat-modal"
        onClose={() => !busy && setExclusao(null)}
        footer={(
          <>
            <Btn variant="ghost" onClick={() => setExclusao(null)} disabled={busy}>Cancelar</Btn>
            <Btn variant="danger" icon="trash" onClick={excluir} disabled={busy}>{busy ? 'Excluindo…' : 'Excluir produto'}</Btn>
          </>
        )}
      >
        <Alert error={exclusao ? error : ''} />
        {exclusao ? (
          <p className="mat-excluir-texto">
            Excluir <strong>{exclusao.nome}</strong>? Fornecedores, especificações, garantia e locais dele também saem. Não dá para desfazer.
          </p>
        ) : null}
      </Modal>
    </Page>
  );
}
