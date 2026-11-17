import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { arquivoEhImagem, publicOrSignedUrl, uploadArquivo } from '../lib/api';
import { tipoDoCondominio, labelMeuImovel } from '../lib/tipoUnidade';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { Modal } from '../components/DataList';
import { Icon } from '../components/icons';
import { formatarTamanho } from '../components/ArquivoPreview';
import { useArrastarOrdenar } from '../lib/useArrastarOrdenar';
import {
  carregarRegrasFinais,
  carregarUnidadesComTipo,
  mensagemErroTipoPorUnidade,
  tipoDoMorador,
  tipoEfetivo,
} from '../lib/tipoPorUnidade';
import { TiposPorUnidadeModal, resumoTipos } from './TiposPorUnidade';

function mensagemErro(err) {
  const msg = String(err?.message || err || '');
  if (/tipos_apartamento|tipo_apartamento_arquivos|schema cache|does not exist|42P01|PGRST204/i.test(msg)) {
    return 'Rode o arquivo supabase/tipos-apartamento.sql no SQL Editor do Supabase e tente de novo.';
  }
  return msg || 'Não foi possível concluir.';
}

async function comUrl(arquivo) {
  if (!arquivo?.storage_path) return arquivo;
  const { data } = await publicOrSignedUrl(arquivo.storage_path);
  return { ...arquivo, url: data?.signedUrl || '' };
}

function arquivosDoTipo(row) {
  return (row?.tipo_apartamento_arquivos || [])
    .slice()
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .map((item) => (item.arquivos ? { ...item.arquivos, vinculoId: item.id } : null))
    .filter(Boolean);
}

function separarArquivos(arquivos) {
  const lista = arquivos || [];
  return {
    imagens: lista.filter((arquivo) => arquivoEhImagem(arquivo) && arquivo.url),
    documentos: lista.filter((arquivo) => !arquivoEhImagem(arquivo)),
  };
}

function extensao(arquivo) {
  const nome = String(arquivo?.nome_original || arquivo?.name || arquivo?.storage_path || '');
  const match = nome.match(/\.([a-z0-9]{1,5})$/i);
  return match ? match[1].toUpperCase() : 'ARQ';
}

function contagem(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`;
}

/** Botão de excluir que pede confirmação no próprio lugar. */
function ExcluirComConfirmacao({ busy, onConfirm, rotulo = 'Excluir', compacto = false }) {
  const [confirmando, setConfirmando] = useState(false);
  if (!confirmando) {
    return (
      <button
        type="button"
        className={`tipo-view-icon-btn${compacto ? ' is-compact' : ''}`}
        disabled={busy}
        aria-label={rotulo}
        title={rotulo}
        onClick={(e) => { e.stopPropagation(); setConfirmando(true); }}
      >
        <Icon name="trash" size={15} />
      </button>
    );
  }
  return (
    <span className="tipo-view-confirm" onClick={(e) => e.stopPropagation()}>
      <span>Excluir?</span>
      <button type="button" className="is-yes" disabled={busy} onClick={() => { setConfirmando(false); onConfirm(); }}>
        Sim
      </button>
      <button type="button" disabled={busy} onClick={() => setConfirmando(false)}>Não</button>
    </span>
  );
}

/** Lista local que acompanha a de fora, mas pode ser reordenada arrastando. */
function useListaLocal(origem) {
  const [lista, setLista] = useState(origem);
  const chave = origem.map((a) => a.vinculoId || a.id).join('|');
  const origemRef = useRef(origem);
  origemRef.current = origem;
  // Só troca quando muda o conjunto/ordem de arquivos (não a cada renderização).
  useEffect(() => { setLista(origemRef.current); }, [chave]);
  return [lista, setLista];
}

const idArquivo = (arquivo) => arquivo.vinculoId || arquivo.id;

function Galeria({ imagens, nome, editable, busy, onRemover, onReordenar }) {
  const [lista, setLista] = useListaLocal(imagens);
  const [atualId, setAtualId] = useState('');
  const total = lista.length;
  const indice = Math.max(0, lista.findIndex((a) => idArquivo(a) === atualId));
  const atual = lista[indice] || null;
  const ordenavel = editable && total > 1 && !busy;
  const { arrastandoId, propsItem } = useArrastarOrdenar({
    itens: lista,
    setItens: setLista,
    getId: idArquivo,
    ativo: ordenavel,
    onSoltar: (nova) => onReordenar?.(nova),
    // A miniatura inteira é um botão: o arraste começa nela.
    ignorar: null,
  });

  if (!atual) {
    return (
      <div className="tipo-view-galeria tipo-view-galeria--vazia">
        <span className="tipo-view-placeholder">{String(nome || '?').slice(0, 2)}</span>
        <p>Nenhuma imagem deste tipo ainda.</p>
      </div>
    );
  }

  function passo(delta) {
    const proximo = lista[(indice + delta + total) % total];
    if (proximo) setAtualId(idArquivo(proximo));
  }

  return (
    <div className="tipo-view-galeria">
      <div className="tipo-view-palco">
        <a href={atual.url} target="_blank" rel="noopener noreferrer" title="Abrir imagem em tamanho real">
          <img src={atual.url} alt={atual.nome_original || `Imagem de ${nome}`} />
        </a>
        {total > 1 ? (
          <>
            <button type="button" className="tipo-view-seta is-prev" aria-label="Imagem anterior" onClick={() => passo(-1)}>
              <Icon name="chevron" size={20} />
            </button>
            <button type="button" className="tipo-view-seta is-next" aria-label="Próxima imagem" onClick={() => passo(1)}>
              <Icon name="chevron" size={20} />
            </button>
          </>
        ) : null}
        <span className="tipo-view-contador">{indice + 1} / {total}</span>
        {editable ? (
          <span className="tipo-view-palco-acoes">
            <ExcluirComConfirmacao busy={busy} rotulo="Excluir esta imagem" onConfirm={() => onRemover(atual)} />
          </span>
        ) : null}
      </div>
      {total > 1 ? (
        <>
          <div className="tipo-view-thumbs" role="tablist" aria-label="Imagens">
            {lista.map((arquivo, i) => (
              <button
                key={idArquivo(arquivo)}
                type="button"
                role="tab"
                aria-selected={i === indice}
                className={[
                  'tipo-view-thumb',
                  i === indice ? 'is-on' : '',
                  ordenavel ? 'arr-ordenavel' : '',
                  arrastandoId === idArquivo(arquivo) ? 'arr-lugar' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setAtualId(idArquivo(arquivo))}
                {...(ordenavel ? propsItem(arquivo) : {})}
              >
                <img src={arquivo.url} alt="" draggable={false} />
              </button>
            ))}
          </div>
          {ordenavel ? <p className="tipo-view-dica">Arraste as miniaturas para mudar a ordem das imagens.</p> : null}
        </>
      ) : null}
    </div>
  );
}

function Documentos({ documentos, editable, busy, onAbrir, onRemover, onReordenar }) {
  const [lista, setLista] = useListaLocal(documentos);
  const ordenavel = editable && lista.length > 1 && !busy;
  const { arrastandoId, propsItem } = useArrastarOrdenar({
    itens: lista,
    setItens: setLista,
    getId: idArquivo,
    ativo: ordenavel,
    onSoltar: (nova) => onReordenar?.(nova),
    // O nome do documento (que abre o arquivo) também serve para arrastar; a lixeira não.
    ignorar: '.tipo-view-icon-btn, .tipo-view-confirm',
  });
  if (!lista.length) {
    return <p className="tipo-view-vazio">Nenhum documento anexado.</p>;
  }
  return (
    <>
      <ul className="tipo-view-docs">
        {lista.map((arquivo) => (
          <li
            key={idArquivo(arquivo)}
            className={[
              'tipo-view-doc',
              ordenavel ? 'arr-ordenavel' : '',
              arrastandoId === idArquivo(arquivo) ? 'arr-lugar' : '',
            ].filter(Boolean).join(' ')}
            {...(ordenavel ? propsItem(arquivo) : {})}
          >
            {ordenavel ? <span className="tipo-view-pegador" aria-hidden="true"><Icon name="menu" size={14} /></span> : null}
            <button type="button" className="tipo-view-doc-main" onClick={() => onAbrir(arquivo)}>
              <span className="tipo-view-ext" aria-hidden="true">{extensao(arquivo)}</span>
              <span className="tipo-view-doc-copy">
                <strong>{arquivo.nome_original || 'Documento'}</strong>
                <small>{arquivo.tamanho_bytes ? formatarTamanho(arquivo.tamanho_bytes) : 'Abrir documento'}</small>
              </span>
              <Icon name="download" size={16} />
            </button>
            {editable ? (
              <ExcluirComConfirmacao busy={busy} rotulo={`Excluir ${arquivo.nome_original || 'documento'}`} onConfirm={() => onRemover(arquivo)} compacto />
            ) : null}
          </li>
        ))}
      </ul>
      {ordenavel ? <p className="tipo-view-dica">Arraste os documentos para mudar a ordem.</p> : null}
    </>
  );
}

/** Visualização de um tipo: galeria à esquerda, informações e documentos à direita. */
function TipoVisualizacao({ tipo, editable, busy, onAbrir, onRemoverArquivo, onReordenarArquivos, rodape = null }) {
  const { imagens, documentos } = separarArquivos(tipo.arquivos);
  // Ordem final de todos os arquivos: imagens, depois documentos, depois o que sobrar.
  function juntar(novasImagens, novosDocumentos) {
    const usados = new Set([...novasImagens, ...novosDocumentos].map(idArquivo));
    const resto = (tipo.arquivos || []).filter((a) => !usados.has(idArquivo(a)));
    onReordenarArquivos?.([...novasImagens, ...novosDocumentos, ...resto]);
  }
  return (
    <div className="tipo-view">
      <Galeria
        key={tipo.id}
        imagens={imagens}
        nome={tipo.nome}
        editable={editable}
        busy={busy}
        onRemover={onRemoverArquivo}
        onReordenar={(nova) => juntar(nova, documentos)}
      />
      <div className="tipo-view-info">
        <header className="tipo-view-head">
          <p>Tipo</p>
          <h2>{tipo.nome}</h2>
        </header>
        {tipo.descricao ? (
          <p className="tipo-view-desc">{tipo.descricao}</p>
        ) : (
          <p className="tipo-view-vazio">Sem descrição.</p>
        )}
        <section className="tipo-view-bloco">
          <h3>Documentos</h3>
          <Documentos
            documentos={documentos}
            editable={editable}
            busy={busy}
            onAbrir={onAbrir}
            onRemover={onRemoverArquivo}
            onReordenar={(nova) => juntar(imagens, nova)}
          />
        </section>
        {rodape}
      </div>
    </div>
  );
}

function SeletorArquivos({ files, onChange, texto }) {
  const ref = useRef(null);
  function adicionar(lista) {
    const novos = [...(lista || [])];
    if (!novos.length) return;
    onChange([...files, ...novos]);
    if (ref.current) ref.current.value = '';
  }
  return (
    <div className="manut-anexos">
      <label className="manut-anexos-drop">
        <input ref={ref} type="file" multiple onChange={(e) => adicionar(e.target.files)} />
        <Icon name="paperclip" size={18} />
        <span>{texto}</span>
      </label>
      {files.length ? (
        <ul className="manut-anexos-lista">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <Icon name={String(file.type).startsWith('image/') ? 'eye' : 'file'} size={15} />
              <span className="manut-anexos-nome">{file.name}</span>
              <small>{formatarTamanho(file.size)}</small>
              <button
                type="button"
                aria-label={`Remover ${file.name}`}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TipoAptoPage() {
  const { condoId, session, cargoTipo } = useSession();
  const isMorador = String(cargoTipo || '').toLowerCase() === 'morador';
  const [rows, setRows] = useState([]);
  const [tipoMoradorId, setTipoMoradorId] = useState('');
  const [tipoUnidade, setTipoUnidade] = useState(null);
  const [form, setForm] = useState({ nome: '', descricao: '', files: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  // 'ver' | 'editar' | 'excluir'
  const [modo, setModo] = useState('ver');
  const [edicao, setEdicao] = useState({ nome: '', descricao: '' });
  const [extraFiles, setExtraFiles] = useState([]);
  const [vinculados, setVinculados] = useState(null);
  const [porUnidadeAberto, setPorUnidadeAberto] = useState(false);
  const [resumoUnidades, setResumoUnidades] = useState(null);
  const { editable, editing, showEditButton, toggleEditing } = useEditTela('manage_catalog');
  const titulo = labelMeuImovel(tipoUnidade);

  async function hidratar(data) {
    return Promise.all((data || []).map(async (row) => {
      const arquivos = await Promise.all(arquivosDoTipo(row).map(comUrl));
      return { ...row, arquivos };
    }));
  }

  async function carregarResumoUnidades() {
    try {
      const [unidades, regras] = await Promise.all([carregarUnidadesComTipo(condoId), carregarRegrasFinais(condoId)]);
      setResumoUnidades(resumoTipos(unidades, regras));
    } catch (err) {
      setResumoUnidades({ erro: mensagemErroTipoPorUnidade(err) });
    }
  }

  async function load() {
    if (!condoId) return;
    const unidades = await supabase.from('unidades').select('identificacao, andar').eq('condominio_id', condoId);
    setTipoUnidade(tipoDoCondominio(unidades.data));

    let moradorTipo = '';
    if (isMorador && session?.user?.id) {
      // O tipo vem da unidade do morador (regra do final ou exceção da unidade).
      moradorTipo = await tipoDoMorador(condoId, session.user.id);
      setTipoMoradorId(moradorTipo);
    } else {
      setTipoMoradorId('');
      carregarResumoUnidades();
    }

    let query = supabase
      .from('tipos_apartamento')
      .select('*, tipo_apartamento_arquivos(id, ordem, arquivos(*))')
      .eq('condominio_id', condoId)
      .order('ordem');
    if (isMorador && moradorTipo) query = query.eq('id', moradorTipo);
    const { data, error: err } = await query;
    if (err) {
      setError(mensagemErro(err));
      setRows([]);
      return;
    }
    setRows(await hidratar(isMorador && !moradorTipo ? [] : (data || [])));
  }

  useEffect(() => { if (condoId) load(); }, [condoId, isMorador, session?.user?.id]);

  const aberto = selectedId ? rows.find((row) => row.id === selectedId) || null : null;
  const tipoMorador = useMemo(
    () => (isMorador ? rows.find((row) => row.id === tipoMoradorId) || rows[0] || null : null),
    [isMorador, rows, tipoMoradorId],
  );

  async function anexar(tipoId, files, ordemInicial) {
    const lista = [...(files || [])];
    for (let index = 0; index < lista.length; index += 1) {
      const arquivo = await uploadArquivo({
        condominioId: condoId,
        userId: session.user.id,
        file: lista[index],
        folder: 'tipos-apartamento',
      });
      const { error: err } = await supabase.from('tipo_apartamento_arquivos').insert({
        tipo_id: tipoId,
        arquivo_id: arquivo.id,
        ordem: ordemInicial + index,
      });
      if (err) throw err;
    }
  }

  async function apagarArquivos(arquivos) {
    const lista = (arquivos || []).filter((arquivo) => arquivo?.id);
    if (!lista.length) return;
    await supabase.from('arquivos').delete().in('id', lista.map((arquivo) => arquivo.id));
    const caminhos = lista.map((arquivo) => arquivo.storage_path).filter(Boolean);
    if (caminhos.length) await supabase.storage.from('condominios').remove(caminhos);
  }

  async function add(e) {
    e.preventDefault();
    const nome = form.nome.trim();
    if (!nome) {
      setError('Informe o nome do tipo.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('tipos_apartamento')
        .insert({
          condominio_id: condoId,
          nome,
          descricao: form.descricao.trim() || null,
          ordem: rows.length,
        })
        .select('id')
        .single();
      if (err) throw err;
      if (form.files.length) await anexar(data.id, form.files, 0);
      setForm({ nome: '', descricao: '', files: [] });
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  function abrirTipo(row) {
    setSelectedId(row.id);
    setModo('ver');
    setExtraFiles([]);
    setError('');
  }

  function fechar() {
    setSelectedId('');
    setModo('ver');
    setExtraFiles([]);
    setVinculados(null);
  }

  function comecarEdicao() {
    if (!aberto) return;
    setEdicao({ nome: aberto.nome || '', descricao: aberto.descricao || '' });
    setModo('editar');
  }

  async function comecarExclusao() {
    if (!aberto) return;
    setModo('excluir');
    setVinculados(null);
    try {
      const [unidades, regras] = await Promise.all([carregarUnidadesComTipo(condoId), carregarRegrasFinais(condoId)]);
      const n = unidades.filter((u) => tipoEfetivo(u, regras).tipoId === aberto.id).length;
      setVinculados({ n, um: 'unidade com este tipo ficará', varios: 'unidades com este tipo ficarão' });
    } catch {
      // SQL de tipo por unidade ainda não rodado: conta os moradores com o tipo antigo.
      const { count } = await supabase
        .from('usuario_condominio')
        .select('usuario_id', { count: 'exact', head: true })
        .eq('condominio_id', condoId)
        .eq('tipo_apartamento_id', aberto.id);
      setVinculados(typeof count === 'number'
        ? { n: count, um: 'morador vinculado ficará', varios: 'moradores vinculados ficarão' }
        : null);
    }
  }

  async function salvarEdicao(e) {
    e.preventDefault();
    if (!aberto) return;
    const nome = String(edicao.nome || '').trim();
    if (!nome) {
      setError('Informe o nome do tipo.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { error: err } = await supabase
        .from('tipos_apartamento')
        .update({ nome, descricao: String(edicao.descricao || '').trim() || null })
        .eq('id', aberto.id);
      if (err) throw err;
      await load();
      setModo('ver');
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function adicionarNoTipo() {
    if (!aberto || !extraFiles.length) return;
    setBusy(true);
    setError('');
    try {
      await anexar(aberto.id, extraFiles, aberto.arquivos?.length || 0);
      setExtraFiles([]);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  /** Salva a nova ordem dos arquivos do tipo aberto (arrastar e soltar). */
  async function salvarOrdemArquivos(lista) {
    if (!aberto) return;
    const anteriores = (aberto.arquivos || []).map((a) => a.vinculoId);
    // Mostra a nova ordem na hora; o banco é atualizado em seguida.
    setRows((atual) => atual.map((row) => (row.id === aberto.id ? { ...row, arquivos: lista } : row)));
    const mudaram = lista
      .map((arquivo, ordem) => ({ arquivo, ordem }))
      .filter(({ arquivo, ordem }) => arquivo.vinculoId && anteriores[ordem] !== arquivo.vinculoId);
    if (!mudaram.length) return;
    setError('');
    const resultados = await Promise.all(mudaram.map(({ arquivo, ordem }) => supabase
      .from('tipo_apartamento_arquivos')
      .update({ ordem })
      .eq('id', arquivo.vinculoId)));
    const falha = resultados.find((r) => r.error);
    if (falha) {
      setError(mensagemErro(falha.error));
      await load();
    }
  }

  async function excluirArquivo(arquivo) {
    if (!arquivo?.vinculoId) return;
    setBusy(true);
    setError('');
    try {
      const { error: err } = await supabase.from('tipo_apartamento_arquivos').delete().eq('id', arquivo.vinculoId);
      if (err) throw err;
      await apagarArquivos([arquivo]);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function excluirTipo() {
    if (!aberto) return;
    setBusy(true);
    setError('');
    try {
      const arquivos = aberto.arquivos || [];
      // Os vínculos com os arquivos saem junto (ON DELETE CASCADE);
      // moradores ligados a este tipo ficam sem tipo (ON DELETE SET NULL).
      const { error: err } = await supabase.from('tipos_apartamento').delete().eq('id', aberto.id);
      if (err) throw err;
      await apagarArquivos(arquivos);
      fechar();
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function baixar(arquivo) {
    if (!arquivo?.storage_path) return;
    const { data, error: err } = await publicOrSignedUrl(arquivo.storage_path);
    if (err || !data?.signedUrl) {
      setError(err?.message || 'Não foi possível abrir o arquivo.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  // Cada botão tem uma key própria: sem isso o React reaproveita o botão
  // "Editar informações" como "Salvar alterações" (type="submit") no meio do
  // clique, e o formulário é enviado na hora, voltando para a visualização.
  const rodapeModal = !editable || !aberto ? null : modo === 'editar' ? (
    <>
      <Btn key="editar-cancelar" variant="ghost" onClick={() => setModo('ver')} disabled={busy}>Cancelar</Btn>
      <Btn key="editar-salvar" type="submit" form="tipo-apto-editar" icon="check" disabled={busy}>
        {busy ? 'Salvando…' : 'Salvar alterações'}
      </Btn>
    </>
  ) : modo === 'excluir' ? (
    <>
      <Btn key="excluir-cancelar" variant="ghost" onClick={() => setModo('ver')} disabled={busy}>Cancelar</Btn>
      <Btn key="excluir-confirmar" variant="danger" icon="trash" onClick={excluirTipo} disabled={busy}>
        {busy ? 'Excluindo…' : 'Excluir tipo'}
      </Btn>
    </>
  ) : (
    <>
      <Btn key="ver-excluir" variant="ghost" icon="trash" onClick={comecarExclusao} disabled={busy} className="tipo-view-btn-danger">
        Excluir tipo
      </Btn>
      <Btn key="ver-editar" icon="pencil" onClick={comecarEdicao} disabled={busy}>Editar informações</Btn>
    </>
  );

  return (
    <Page
      title={titulo}
      actions={showEditButton && !isMorador ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={!aberto ? error : ''} />

      {isMorador ? (
        tipoMorador ? (
          <article className="panel tipo-view-panel">
            <TipoVisualizacao tipo={tipoMorador} editable={false} busy={busy} onAbrir={baixar} />
          </article>
        ) : (
          <Empty text={`Nenhum tipo vinculado a este ${tipoUnidade === 'casas' ? 'imóvel' : 'apartamento'} ainda.`} />
        )
      ) : (
        <>
          {!rows.length ? (
            <Empty text="Nenhum tipo cadastrado ainda." />
          ) : (
            <ul className="tipo-apto-grid">
              {rows.map((row) => {
                const capa = separarArquivos(row.arquivos).imagens[0];
                return (
                  <li key={row.id}>
                    <button type="button" className="tipo-apto-card" onClick={() => abrirTipo(row)}>
                      <span className="tipo-apto-cover">
                        {capa ? <img src={capa.url} alt="" /> : <strong>{row.nome}</strong>}
                      </span>
                      <span className="tipo-apto-copy">
                        <strong>{row.nome}</strong>
                        {row.descricao ? <small>{row.descricao}</small> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {editable && rows.length ? (
            <section className="panel tpu-painel">
              <span className="tpu-painel-icone" aria-hidden="true"><Icon name="building" size={22} /></span>
              <div className="tpu-painel-texto">
                <h2>Tipo de cada {tipoUnidade === 'casas' ? 'casa' : 'unidade'}</h2>
                {resumoUnidades?.erro ? (
                  <p className="tpu-painel-erro">{resumoUnidades.erro}</p>
                ) : resumoUnidades ? (
                  <p>
                    {resumoUnidades.comTipo} de {resumoUnidades.total} {resumoUnidades.total === 1 ? 'unidade' : 'unidades'} com tipo
                    {resumoUnidades.semTipo ? ` · ${resumoUnidades.semTipo} sem tipo` : ''}.
                    {' '}O morador vê o tipo da unidade dele.
                  </p>
                ) : (
                  <p>Carregando…</p>
                )}
              </div>
              <Btn icon="pencil" onClick={() => setPorUnidadeAberto(true)}>
                {tipoUnidade === 'casas' ? 'Definir tipos' : 'Definir por final e exceções'}
              </Btn>
            </section>
          ) : null}

          {editable ? (
            <form className="panel stack tipo-apto-form" onSubmit={add}>
              <h2>Novo tipo</h2>
              <Field label="Nome (tipo)">
                <input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder={tipoUnidade === 'casas' ? 'Ex.: Casa térrea' : 'A, B, C, D…'}
                  required
                />
              </Field>
              <Field label="Descrição">
                <textarea
                  value={form.descricao}
                  rows={4}
                  placeholder="Resumo deste tipo"
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                />
              </Field>
              <SeletorArquivos
                files={form.files}
                onChange={(files) => setForm({ ...form, files })}
                texto="Toque para anexar plantas, imagens ou documentos"
              />
              <Btn type="submit" icon="plus" disabled={busy}>
                {busy ? 'Salvando…' : 'Adicionar tipo'}
              </Btn>
            </form>
          ) : null}
        </>
      )}

      <Modal
        open={Boolean(aberto) && !isMorador}
        title={modo === 'editar' ? `Editar ${aberto?.nome || 'tipo'}` : modo === 'excluir' ? `Excluir ${aberto?.nome || 'tipo'}` : (aberto?.nome || 'Tipo')}
        className="modal-sheet--wide tipo-apto-modal"
        onClose={fechar}
        footer={rodapeModal}
      >
        <Alert error={aberto ? error : ''} />
        {!aberto ? null : modo === 'editar' ? (
          <form id="tipo-apto-editar" className="stack" onSubmit={salvarEdicao}>
            <Field label="Nome (tipo)">
              <input value={edicao.nome} onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })} required autoFocus />
            </Field>
            <Field label="Descrição">
              <textarea
                value={edicao.descricao}
                rows={5}
                onChange={(e) => setEdicao({ ...edicao, descricao: e.target.value })}
              />
            </Field>
            <p className="hint">Imagens e documentos são excluídos direto na visualização, pelo ícone de lixeira.</p>
          </form>
        ) : modo === 'excluir' ? (
          <div className="tipo-view-excluir">
            <span className="tipo-view-excluir-icon" aria-hidden="true"><Icon name="alert" size={22} /></span>
            <div>
              <strong>Excluir o tipo {aberto.nome}?</strong>
              <p>
                {contagem(aberto.arquivos?.length || 0, 'arquivo', 'arquivos')} deste tipo também serão apagados.
                {vinculados?.n ? ` ${contagem(vinculados.n, vinculados.um, vinculados.varios)} sem tipo.` : ''}
                {' '}Não dá para desfazer.
              </p>
            </div>
          </div>
        ) : (
          <TipoVisualizacao
            tipo={aberto}
            editable={editable}
            busy={busy}
            onReordenarArquivos={salvarOrdemArquivos}
            onAbrir={baixar}
            onRemoverArquivo={excluirArquivo}
            rodape={editable ? (
              <section className="tipo-view-bloco">
                <h3>Adicionar arquivos</h3>
                <SeletorArquivos
                  files={extraFiles}
                  onChange={setExtraFiles}
                  texto="Toque para anexar imagens ou documentos"
                />
                {extraFiles.length ? (
                  <Btn icon="paperclip" onClick={adicionarNoTipo} disabled={busy}>
                    {busy ? 'Enviando…' : `Anexar ${contagem(extraFiles.length, 'arquivo', 'arquivos')}`}
                  </Btn>
                ) : null}
              </section>
            ) : null}
          />
        )}
      </Modal>

      <TiposPorUnidadeModal
        open={porUnidadeAberto && !isMorador}
        onClose={() => setPorUnidadeAberto(false)}
        condoId={condoId}
        tipos={rows}
        tipoUnidade={tipoUnidade}
        onSalvo={carregarResumoUnidades}
      />
    </Page>
  );
}
