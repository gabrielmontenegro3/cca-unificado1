import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { arquivoEhImagem, publicOrSignedUrl, uploadArquivo } from '../lib/api';
import { tipoDoCondominio, labelMeuImovel } from '../lib/tipoUnidade';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { Modal } from '../components/DataList';
import { Icon } from '../components/icons';

function mensagemErro(err) {
  const msg = String(err?.message || err || '');
  if (/tipos_apartamento|tipo_apartamento_arquivos|schema cache|does not exist|42P01|PGRST204/i.test(msg)) {
    return 'Rode o arquivo supabase/tipos-apartamento.sql no SQL Editor do Supabase e tente de novo.';
  }
  return msg || 'Não foi possível concluir.';
}

function ehPdf(arquivo) {
  const mime = String(arquivo?.mime_type || arquivo?.type || '').toLowerCase();
  const nome = String(arquivo?.nome_original || arquivo?.name || arquivo?.storage_path || '').toLowerCase();
  return mime === 'application/pdf' || nome.endsWith('.pdf');
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

function PreviaImagens({ imagens, previaId, onSelect }) {
  const atual = imagens.find((arquivo) => arquivo.id === previaId) || imagens[0] || null;
  if (!atual) return null;
  return (
    <div className="stack">
      <img className="tipo-apto-previa" src={atual.url} alt={atual.nome_original || ''} />
      {imagens.length > 1 ? (
        <div className="tipo-apto-thumbs">
          {imagens.map((arquivo) => (
            <button
              key={arquivo.id}
              type="button"
              className={`tipo-apto-thumb${atual.id === arquivo.id ? ' is-on' : ''}`}
              onClick={() => onSelect?.(arquivo.id)}
            >
              <img src={arquivo.url} alt="" />
              <span>{arquivo.nome_original || 'Imagem'}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ListaDocumentos({ documentos, editable, busy, onAbrir, onRemover }) {
  if (!documentos?.length) {
    return <p className="hint" style={{ margin: 0 }}>Nenhum documento anexado.</p>;
  }
  return (
    <ul className="tipo-apto-files">
      {documentos.map((arquivo) => (
        <li key={arquivo.vinculoId || arquivo.id} className="tipo-apto-file">
          <span className="tipo-apto-file-icon" aria-hidden="true">
            <Icon name="file" size={28} />
          </span>
          <strong>{arquivo.nome_original || 'Documento'}</strong>
          <div className="tipo-apto-file-actions">
            <Btn variant="ghost" icon="download" onClick={() => onAbrir(arquivo)}>Abrir</Btn>
            {editable ? (
              <Btn variant="ghost" icon="x" disabled={busy} onClick={() => onRemover(arquivo)}>
                Remover
              </Btn>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PreviaArquivosLocais({ files }) {
  const imagens = [...(files || [])].filter((file) => String(file.type || '').startsWith('image/'));
  if (!imagens.length) return null;
  return (
    <div className="tipo-apto-thumbs">
      {imagens.map((file) => (
        <span key={`${file.name}-${file.lastModified}`} className="tipo-apto-thumb">
          <img src={URL.createObjectURL(file)} alt="" />
          <span>{file.name}</span>
        </span>
      ))}
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
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [edicao, setEdicao] = useState(null);
  const [previaId, setPreviaId] = useState('');
  const [extraFiles, setExtraFiles] = useState([]);
  const { editable, editing, showEditButton, toggleEditing } = useEditTela('manage_catalog');
  const titulo = labelMeuImovel(tipoUnidade);

  async function hidratar(data) {
    return Promise.all((data || []).map(async (row) => {
      const arquivos = await Promise.all(arquivosDoTipo(row).map(comUrl));
      return { ...row, arquivos };
    }));
  }

  async function load() {
    if (!condoId) return;
    const unidades = await supabase.from('unidades').select('identificacao, andar').eq('condominio_id', condoId);
    setTipoUnidade(tipoDoCondominio(unidades.data));

    let moradorTipo = '';
    if (isMorador && session?.user?.id) {
      const vinculo = await supabase
        .from('usuario_condominio')
        .select('tipo_apartamento_id')
        .eq('condominio_id', condoId)
        .eq('usuario_id', session.user.id)
        .maybeSingle();
      moradorTipo = vinculo.data?.tipo_apartamento_id || '';
      setTipoMoradorId(moradorTipo);
    } else {
      setTipoMoradorId('');
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
    const lista = await hidratar(isMorador && !moradorTipo ? [] : (data || []));
    setRows(lista);
    setSelected((atual) => (atual ? lista.find((row) => row.id === atual.id) || null : null));
  }

  useEffect(() => { if (condoId) load(); }, [condoId, isMorador, session?.user?.id]);

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
      setFormKey((value) => value + 1);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function adicionarNoTipo(e) {
    e.preventDefault();
    if (!selected || !extraFiles.length) return;
    setBusy(true);
    setError('');
    try {
      await anexar(selected.id, extraFiles, selected.arquivos?.length || 0);
      setExtraFiles([]);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function excluirArquivo(arquivo) {
    if (!selected || !arquivo?.vinculoId) return;
    setBusy(true);
    setError('');
    try {
      const { error: err } = await supabase.from('tipo_apartamento_arquivos').delete().eq('id', arquivo.vinculoId);
      if (err) throw err;
      if (arquivo.id) await supabase.from('arquivos').delete().eq('id', arquivo.id);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function salvarEdicao(e) {
    e.preventDefault();
    if (!aberto) return;
    const nome = String(edicao?.nome || '').trim();
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

  const aberto = selected ? rows.find((row) => row.id === selected.id) || selected : null;
  const tipoMorador = useMemo(
    () => (isMorador ? rows.find((row) => row.id === tipoMoradorId) || rows[0] || null : null),
    [isMorador, rows, tipoMoradorId],
  );

  function abrirTipo(row) {
    setSelected(row);
    const { imagens } = separarArquivos(row.arquivos);
    setPreviaId(imagens[0]?.id || '');
    setEdicao({ nome: row.nome || '', descricao: row.descricao || '' });
  }

  function detalheDe(row, { noModal } = {}) {
    const { imagens, documentos } = separarArquivos(row.arquivos);
    return (
      <div className="stack">
        <PreviaImagens imagens={imagens} previaId={previaId} onSelect={setPreviaId} />
        {row.descricao ? <p>{row.descricao}</p> : null}
        <div className="stack">
          <h3>Documentos</h3>
          <ListaDocumentos
            documentos={documentos}
            editable={editable && !noModal}
            busy={busy}
            onAbrir={baixar}
            onRemover={excluirArquivo}
          />
        </div>
      </div>
    );
  }

  return (
    <Page
      title={titulo}
      actions={showEditButton && !isMorador ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={error} />

      {isMorador ? (
        tipoMorador ? (
          <article className="panel stack">
            <header className="meu-imovel-tipo-head">
              <p>Tipo</p>
              <h2>{tipoMorador.nome}</h2>
            </header>
            {detalheDe(tipoMorador, { noModal: true })}
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
                const { imagens, documentos } = separarArquivos(row.arquivos);
                const capa = imagens[0];
                return (
                  <li key={row.id}>
                    <button type="button" className="tipo-apto-card" onClick={() => abrirTipo(row)}>
                      <span className="tipo-apto-cover">
                        {capa ? <img src={capa.url} alt="" /> : <strong>{row.nome}</strong>}
                      </span>
                      <span className="tipo-apto-copy">
                        <strong>{row.nome}</strong>
                        <small>{row.descricao || 'Sem descrição'}</small>
                        <em>{documentos.length === 1 ? '1 documento' : `${documentos.length} documentos`}</em>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

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
              <Field label="Documentos">
                <input
                  key={formKey}
                  type="file"
                  multiple
                  onChange={(e) => setForm({ ...form, files: [...(e.target.files || [])] })}
                />
              </Field>
              <PreviaArquivosLocais files={form.files} />
              {form.files.length ? (
                <ul className="tipo-apto-files">
                  {[...form.files].filter((file) => !String(file.type || '').startsWith('image/')).map((file) => (
                    <li key={`${file.name}-${file.size}`} className="tipo-apto-file">
                      <span className="tipo-apto-file-icon" aria-hidden="true"><Icon name="file" size={22} /></span>
                      <strong>{file.name}</strong>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Btn type="submit" icon="plus" disabled={busy}>
                {busy ? 'Salvando…' : 'Adicionar tipo'}
              </Btn>
            </form>
          ) : null}
        </>
      )}

      <Modal
        open={Boolean(aberto) && !isMorador}
        title={aberto ? aberto.nome : 'Tipo'}
        className="modal-sheet--wide"
        onClose={() => { setSelected(null); setExtraFiles([]); setEdicao(null); setPreviaId(''); }}
        footer={editable && aberto ? (
          <Btn icon="pencil" disabled={busy} onClick={() => setEdicao((atual) => atual || { nome: aberto.nome, descricao: aberto.descricao || '' })}>
            Editar
          </Btn>
        ) : null}
      >
        {aberto ? (
          <div className="stack">
            {editable && edicao ? (
              <form className="stack" onSubmit={salvarEdicao}>
                <h3>Editar tipo</h3>
                <Field label="Nome (tipo)">
                  <input value={edicao.nome} onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })} required />
                </Field>
                <Field label="Descrição">
                  <textarea
                    value={edicao.descricao}
                    rows={4}
                    onChange={(e) => setEdicao({ ...edicao, descricao: e.target.value })}
                  />
                </Field>
                <Btn type="submit" icon="check" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</Btn>
              </form>
            ) : (
              detalheDe(aberto)
            )}
            {editable ? (
              <form className="stack" onSubmit={adicionarNoTipo}>
                <Field label="Incluir documentos ou imagens">
                  <input
                    type="file"
                    multiple
                    onChange={(e) => setExtraFiles([...(e.target.files || [])])}
                  />
                </Field>
                <PreviaArquivosLocais files={extraFiles} />
                <Btn type="submit" icon="paperclip" disabled={busy || !extraFiles.length}>
                  Anexar
                </Btn>
              </form>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </Page>
  );
}
