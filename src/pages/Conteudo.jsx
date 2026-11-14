import { useEffect, useRef, useState } from 'react';
import { useArrastarOrdenar } from '../lib/useArrastarOrdenar';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { documentoVisivelPara } from '../lib/permissions';
import { uploadArquivo, publicOrSignedUrl } from '../lib/api';
import { formatDate, formatTelefone } from '../lib/format';
import { Alert, Btn, Empty, Field, MaskedInput, Page } from '../components/ui';
import { Icon } from '../components/icons';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { DataList, DetailFields, Modal } from '../components/DataList';

function extensaoArquivo(row) {
  const nome = row?.arquivos?.nome_original || row?.titulo || '';
  const mime = String(row?.arquivos?.mime_type || '').toLowerCase();
  const ext = String(nome).split('.').pop()?.toLowerCase();
  if (ext && ext.length <= 5 && ext !== nome.toLowerCase()) return ext.toUpperCase();
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('word') || mime.includes('document')) return 'DOC';
  if (mime.includes('sheet') || mime.includes('excel')) return 'XLS';
  if (mime.includes('image')) return 'IMG';
  return 'ARQ';
}

function nomeDocumento(row) {
  return row?.titulo
    || row?.arquivos?.nome_original
    || 'Documento';
}

export function DocumentosPage() {
  const { condoId, session, cargoTipo } = useSession();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ titulo: '', descricao: '', file: null, publico: '' });
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const { editable, editing, showEditButton, toggleEditing } = useEditTela('manage_content');
  const rowsRef = useRef([]);
  const filaOrdemRef = useRef(Promise.resolve());
  const ordemTokenRef = useRef(0);
  const podeOrdenar = editable && !q.trim();

  async function load() {
    const { data, error: err } = await supabase
      .from('documentos_empreendimento')
      .select('*, arquivos(*)')
      .eq('condominio_id', condoId)
      .order('ordem');
    if (err) setError(err.message);
    const lista = data || [];
    rowsRef.current = lista;
    setRows(lista);
  }

  useEffect(() => { if (condoId) load(); }, [condoId]);

  async function add(e) {
    e.preventDefault();
    if (!form.file) return setError('Selecione um arquivo.');
    if (form.publico !== 'sindico' && form.publico !== 'morador') {
      return setError('Marque se o documento é para o síndico ou para o morador.');
    }
    setError('');
    try {
      const arquivo = await uploadArquivo({
        condominioId: condoId,
        userId: session.user.id,
        file: form.file,
        folder: 'documentos',
      });
      const { error: err } = await supabase.from('documentos_empreendimento').insert({
        condominio_id: condoId,
        arquivo_id: arquivo.id,
        titulo: form.titulo || form.file.name,
        descricao: form.descricao,
        ordem: rows.length,
        publico: form.publico,
      });
      if (err) throw err;
      setForm({ titulo: '', descricao: '', file: null, publico: '' });
      load();
    } catch (err) {
      const msg = String(err.message || '');
      if (/publico|schema cache|could not find|column/i.test(msg)) {
        setError('Não foi possível gravar o público do documento. Rode o arquivo supabase/documentos-publico.sql no SQL Editor do Supabase e tente de novo.');
      } else {
        setError(msg);
      }
    }
  }

  async function baixar(row) {
    const path = row?.arquivos?.storage_path;
    if (!path) {
      setError('Arquivo indisponível para download.');
      return;
    }
    setBusyId(row.id);
    setError('');
    try {
      const { data, error: err } = await publicOrSignedUrl(path);
      if (err) throw err;
      const url = data?.signedUrl;
      if (!url) throw new Error('Não foi possível gerar o link de download.');

      const fileName = row.arquivos?.nome_original || nomeDocumento(row);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Falha ao baixar o arquivo.');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      // Fallback: abre em nova aba se o blob falhar (CORS etc.)
      try {
        const { data } = await publicOrSignedUrl(path);
        if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
        else throw err;
      } catch {
        setError(err.message || 'Não foi possível baixar o documento.');
      }
    } finally {
      setBusyId('');
    }
  }

  async function salvarOrdem(lista) {
    const resultados = await Promise.all(lista.map((row, index) => (
      supabase.from('documentos_empreendimento').update({ ordem: index }).eq('id', row.id)
    )));
    const falha = resultados.find((resultado) => resultado.error);
    if (falha?.error) throw falha.error;
  }

  function gravarOrdem(lista) {
    const token = ++ordemTokenRef.current;
    filaOrdemRef.current = filaOrdemRef.current
      .catch(() => {})
      .then(() => salvarOrdem(lista))
      .catch((err) => {
        if (token !== ordemTokenRef.current) return;
        setError(err.message || 'Não foi possível salvar a ordem.');
        load();
      });
  }

  // Arrastar e soltar seguro (sem duplicar): só muda a posição e salva a ordem.
  const { arrastandoId, propsItem } = useArrastarOrdenar({
    itens: rows,
    setItens: (lista) => {
      rowsRef.current = lista;
      setRows(lista);
    },
    getId: (row) => row.id,
    ativo: podeOrdenar,
    onSoltar: (lista) => {
      const numerada = lista.map((row, index) => ({ ...row, ordem: index }));
      rowsRef.current = numerada;
      setRows(numerada);
      gravarOrdem(numerada);
    },
    ignorar: '.docs-folder-actions, a, input, textarea, select',
  });

  async function excluir(row) {
    if (!editable || !row?.id) return;
    const nome = nomeDocumento(row);
    if (!window.confirm(`Excluir o documento “${nome}”?`)) return;
    setBusyId(row.id);
    setError('');
    try {
      const { error: err } = await supabase.from('documentos_empreendimento').delete().eq('id', row.id);
      if (err) throw err;
      if (row.arquivo_id) {
        await supabase.from('arquivos').delete().eq('id', row.arquivo_id);
      }
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível excluir o documento.');
    } finally {
      setBusyId('');
    }
  }

  const filtered = rows.filter((r) => {
    if (!documentoVisivelPara(r, cargoTipo)) return false;
    const hay = `${nomeDocumento(r)} ${r.descricao || ''} ${r.arquivos?.nome_original || ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <Page
      title="Documentos"
      search={{
        value: q,
        onChange: setQ,
        placeholder: 'Procurar documento…',
      }}
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={error} />

      {podeOrdenar && filtered.length > 1 ? (
        <p className="hint docs-order-hint">Segure uma pasta e solte na posição da ordem.</p>
      ) : null}

      {!filtered.length ? (
        <Empty text={q ? 'Nenhum documento encontrado.' : 'Nenhum documento enviado ainda.'} />
      ) : (
        <ul className="docs-folder-grid">
          {filtered.map((row) => (
            <li
              key={row.id}
              className={[
                'docs-folder',
                podeOrdenar ? 'is-sortable' : '',
                arrastandoId === row.id ? 'is-placeholder' : '',
              ].filter(Boolean).join(' ')}
              data-doc-id={row.id}
              {...propsItem(row)}
            >
              <div className="docs-folder-visual" aria-hidden="true">
                <span className="docs-folder-tab" />
                <span className="docs-folder-body">
                  <Icon name="file" size={36} />
                  <span className="docs-folder-ext">{extensaoArquivo(row)}</span>
                </span>
              </div>
              <div className="docs-folder-info">
                <strong className="docs-folder-title" title={nomeDocumento(row)}>
                  {nomeDocumento(row)}
                </strong>
                {row.descricao ? (
                  <p className="docs-folder-desc">{row.descricao}</p>
                ) : (
                  <p className="docs-folder-desc muted">
                    {row.arquivos?.nome_original && row.arquivos.nome_original !== nomeDocumento(row)
                      ? row.arquivos.nome_original
                      : 'Documento do empreendimento'}
                  </p>
                )}
                {row.publico === 'sindico' || row.publico === 'morador' ? (
                  <span className={`docs-folder-publico is-${row.publico}`}>
                    {row.publico === 'sindico' ? 'Síndico' : 'Morador'}
                  </span>
                ) : null}
                <span className="docs-folder-date">
                  {row.created_at ? formatDate(row.created_at) : '—'}
                </span>
              </div>
              <div className="docs-folder-actions">
                <Btn
                  icon="download"
                  className="docs-folder-download"
                  disabled={busyId === row.id || !row.arquivos?.storage_path}
                  onClick={() => baixar(row)}
                >
                  {busyId === row.id ? 'Baixando…' : 'Download'}
                </Btn>
                {editable ? (
                  <Btn
                    variant="ghost"
                    icon="x"
                    className="docs-folder-delete"
                    disabled={busyId === row.id}
                    onClick={() => excluir(row)}
                  >
                    Excluir
                  </Btn>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <form className="panel stack docs-upload" onSubmit={add}>
          <h2>Enviar documento</h2>
          <Field label="Título">
            <input
              value={form.titulo}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              placeholder="Opcional — usa o nome do arquivo"
            />
          </Field>
          <Field label="Descrição">
            <input
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </Field>
          <Field label="Arquivo">
            <input
              type="file"
              onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })}
              required
            />
          </Field>
          <Field label="Disponível para">
            <div className="docs-publico" role="group" aria-label="Disponível para">
              <button
                type="button"
                className={form.publico === 'sindico' ? 'is-on' : ''}
                aria-pressed={form.publico === 'sindico'}
                onClick={() => setForm({ ...form, publico: 'sindico' })}
              >
                Síndico
              </button>
              <button
                type="button"
                className={form.publico === 'morador' ? 'is-on' : ''}
                aria-pressed={form.publico === 'morador'}
                onClick={() => setForm({ ...form, publico: 'morador' })}
              >
                Morador
              </button>
            </div>
          </Field>
          <Btn type="submit" icon="paperclip">Enviar</Btn>
        </form>
      ) : null}
    </Page>
  );
}

export function ContatosPage() {
  const { condoId } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ nome: '', subtitulo: '', telefone: '', email: '' });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const { editable, editing, showEditButton, toggleEditing } = useEditTela('manage_catalog');

  async function load() {
    const { data, error: err } = await supabase.from('contatos').select('*').eq('condominio_id', condoId).order('ordem');
    if (err) setError(err.message);
    setRows(data || []);
  }
  useEffect(() => { if (condoId) load(); }, [condoId]);

  async function add(e) {
    e.preventDefault();
    const { error: err } = await supabase.from('contatos').insert({ ...form, condominio_id: condoId, ordem: rows.length });
    if (err) setError(err.message);
    else {
      setForm({ nome: '', subtitulo: '', telefone: '', email: '' });
      load();
    }
  }

  const ativos = rows.filter((r) => r.ativo);

  return (
    <Page
      title="Contatos"
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={error} />
      <DataList
        rows={ativos}
        empty="Nenhum contato."
        getTitle={(row) => row.nome}
        getSubtitle={(row) => row.subtitulo || ''}
        getTags={(row) => [
          row.telefone ? { key: 'tel', icon: 'phone', label: formatTelefone(row.telefone) || row.telefone } : null,
          row.email ? { key: 'mail', icon: 'mail', label: row.email } : null,
        ]}
        onSelect={setSelected}
      />
      {editable ? (
        <form className="panel stack" onSubmit={add} style={{ marginTop: 16 }}>
          <h2>Novo contato</h2>
          <Field label="Nome"><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required /></Field>
          <Field label="Subtítulo"><input value={form.subtitulo} onChange={(e) => setForm({ ...form, subtitulo: e.target.value })} /></Field>
          <Field label="Telefone">
            <MaskedInput
              mask="telefone"
              value={form.telefone}
              onChange={(telefone) => setForm({ ...form, telefone })}
            />
          </Field>
          <Field label="E-mail"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Btn type="submit" icon="check">Salvar</Btn>
        </form>
      ) : null}

      <Modal
        open={Boolean(selected)}
        title={selected?.nome || 'Contato'}
        onClose={() => setSelected(null)}
      >
        <DetailFields
          fields={[
            { label: 'Nome', value: selected?.nome },
            { label: 'Subtítulo', value: selected?.subtitulo || '—' },
            { label: 'Telefone', value: selected?.telefone ? (formatTelefone(selected.telefone) || selected.telefone) : '—' },
            { label: 'E-mail', value: selected?.email || '—' },
          ]}
        />
      </Modal>
    </Page>
  );
}
