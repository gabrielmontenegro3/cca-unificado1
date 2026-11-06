import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { formatDate } from '../lib/format';
import { publicOrSignedUrl, uploadArquivo } from '../lib/api';
import { Alert, Btn, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { DataList, DetailFields, Modal } from '../components/DataList';
import { Icon } from '../components/icons';
import { ArquivoPreviewCard, formatarTamanho } from '../components/ArquivoPreview';

const SQL_ANEXOS = 'supabase/boletins-sindico-anexos.sql';
const CAMPOS_ARQUIVO = 'id, nome_original, storage_path, mime_type, tipo, tamanho_bytes';
const FORM_VAZIO = { titulo: '', subtitulo: '', texto: '' };

function um(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function comUrls(arquivos) {
  return Promise.all(arquivos.map(async (arquivo) => {
    if (!arquivo?.storage_path) return { ...arquivo, url: '' };
    const { data } = await publicOrSignedUrl(arquivo.storage_path);
    return { ...arquivo, url: data?.signedUrl || '' };
  }));
}

function faltaSqlAnexos(err) {
  return /boletim_anexos|p_arquivos|relationship|PGRST200|PGRST202|could not find the function|schema cache/i
    .test(String(err?.message || err?.code || ''));
}

export function BoletinsPage() {
  const { condoId, session } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(FORM_VAZIO);
  const [anexos, setAnexos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [selected, setSelected] = useState(null);
  const fileRef = useRef(null);
  const { editable, editing, showEditButton, toggleEditing } = useEditTela('manage_boletins');

  async function load() {
    function buscar(comAnexos) {
      let query = supabase
        .from('boletins_informativos')
        .select(comAnexos
          ? `*, usuarios(nome), boletim_anexos(ordem, arquivos(${CAMPOS_ARQUIVO}))`
          : '*, usuarios(nome)')
        .eq('condominio_id', condoId)
        .order('created_at', { ascending: false });
      if (!editable) query = query.eq('publicado', true);
      return query;
    }
    let { data, error: err } = await buscar(true);
    let semTabela = false;
    if (err && faltaSqlAnexos(err)) {
      semTabela = true;
      ({ data, error: err } = await buscar(false));
    }
    if (err) setError(err.message);
    setAviso(semTabela && editable ? `Para anexar arquivos aos boletins, rode ${SQL_ANEXOS} no SQL Editor do Supabase.` : '');
    const lista = await Promise.all((data || []).map(async (row) => {
      const arquivos = [...(row.boletim_anexos || [])]
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
        .map((v) => um(v.arquivos))
        .filter(Boolean);
      return { ...row, arquivos: await comUrls(arquivos) };
    }));
    setRows(lista);
  }
  useEffect(() => { if (condoId) load(); }, [condoId, editable]);

  function adicionarArquivos(lista) {
    const novos = [...(lista || [])];
    if (!novos.length) return;
    setAnexos((atual) => [...atual, ...novos]);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function add(e, publicado) {
    e.preventDefault();
    if (!editable || busy) return;
    if (!form.titulo.trim()) {
      setError('Informe o título do boletim.');
      return;
    }
    if (!form.texto.trim() && !anexos.length) {
      setError('Escreva o texto ou anexe um arquivo ou imagem.');
      return;
    }
    setBusy(true);
    setError('');
    const enviados = [];
    try {
      for (const file of anexos) {
        const arquivo = await uploadArquivo({ condominioId: condoId, userId: session.user.id, file, folder: 'boletins' });
        enviados.push(arquivo.id);
      }
      const payload = {
        p_condominio_id: condoId,
        p_titulo: form.titulo.trim(),
        p_subtitulo: form.subtitulo.trim() || null,
        p_texto: form.texto.trim(),
        p_publicado: publicado,
      };
      if (enviados.length) payload.p_arquivos = enviados;
      const rpc = await supabase.rpc('criar_boletim', payload);
      if (rpc.error) {
        // Sem anexos e sem a função no banco: grava direto na tabela (fluxo antigo).
        if (enviados.length || !faltaSqlAnexos(rpc.error)) throw rpc.error;
        const { error: err } = await supabase.from('boletins_informativos').insert({
          condominio_id: condoId,
          autor_id: session.user.id,
          titulo: payload.p_titulo,
          subtitulo: payload.p_subtitulo,
          texto: payload.p_texto,
          publicado,
          data_publicacao: publicado ? new Date().toISOString() : null,
        });
        if (err) throw err;
      }
      setForm(FORM_VAZIO);
      setAnexos([]);
      load();
    } catch (err) {
      if (enviados.length) await supabase.from('arquivos').delete().in('id', enviados);
      setError(faltaSqlAnexos(err) || /row-level security|Somente/i.test(err?.message || '')
        ? `Rode o arquivo ${SQL_ANEXOS} no SQL Editor do Supabase e tente de novo.`
        : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row) {
    if (!editable) return;
    const publicado = !row.publicado;
    const { error: err } = await supabase.from('boletins_informativos').update({
      publicado,
      data_publicacao: publicado ? new Date().toISOString() : row.data_publicacao,
    }).eq('id', row.id);
    if (err) setError(err.message);
    else {
      load();
      setSelected((cur) => (cur?.id === row.id ? { ...cur, publicado, data_publicacao: publicado ? new Date().toISOString() : row.data_publicacao } : cur));
    }
  }

  return (
    <Page
      title="Boletins informativos"
      lead={editable
        ? 'Comunicados do condomínio, com texto, arquivos e imagens. O morador vê apenas os itens publicados.'
        : 'Comunicados publicados deste condomínio.'}
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={error} />
      {aviso ? <p className="hint">{aviso}</p> : null}
      <DataList
        rows={rows}
        empty="Nenhum boletim."
        getTitle={(row) => row.titulo}
        getSubtitle={(row) => [row.subtitulo, row.usuarios?.nome].filter(Boolean).join(' · ')}
        getTags={(row) => [
          row.data_publicacao || row.created_at
            ? { key: 'data', icon: 'calendar', label: formatDate(row.data_publicacao || row.created_at) }
            : null,
          row.arquivos.length
            ? { key: 'anexos', icon: 'paperclip', label: `${row.arquivos.length} ${row.arquivos.length === 1 ? 'anexo' : 'anexos'}` }
            : null,
          editable
            ? { key: 'status', icon: row.publicado ? 'check' : 'file', label: row.publicado ? 'Publicado' : 'Rascunho' }
            : null,
        ]}
        onSelect={setSelected}
      />
      {editable ? (
        <form className="panel stack" onSubmit={(e) => add(e, false)} style={{ marginTop: 16 }}>
          <h2>Novo boletim</h2>
          <Field label="Título"><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required /></Field>
          <Field label="Subtítulo"><input value={form.subtitulo} onChange={(e) => setForm({ ...form, subtitulo: e.target.value })} /></Field>
          <Field label="Texto">
            <textarea
              value={form.texto}
              onChange={(e) => setForm({ ...form, texto: e.target.value })}
              placeholder={anexos.length ? 'Opcional quando há anexo' : ''}
            />
          </Field>
          <div className="manut-anexos">
            <span className="manut-anexos-label">Arquivos e imagens</span>
            <label className="manut-anexos-drop">
              <input
                ref={fileRef}
                type="file"
                multiple
                onChange={(e) => adicionarArquivos(e.target.files)}
              />
              <Icon name="paperclip" size={18} />
              <span>Toque para anexar imagens, PDFs ou outros arquivos</span>
            </label>
            {anexos.length ? (
              <ul className="manut-anexos-lista">
                {anexos.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <Icon name={String(file.type).startsWith('image/') ? 'eye' : 'file'} size={15} />
                    <span className="manut-anexos-nome">{file.name}</span>
                    <small>{formatarTamanho(file.size)}</small>
                    <button
                      type="button"
                      aria-label={`Remover ${file.name}`}
                      onClick={() => setAnexos((atual) => atual.filter((_, i) => i !== index))}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="row">
            <Btn variant="ghost" type="submit" icon="file" disabled={busy}>
              {busy ? 'Enviando…' : 'Salvar rascunho'}
            </Btn>
            <Btn icon="check" onClick={(e) => add(e, true)} disabled={busy}>
              {busy ? 'Enviando…' : 'Publicar'}
            </Btn>
          </div>
        </form>
      ) : null}

      <Modal
        open={Boolean(selected)}
        title={selected?.titulo || 'Boletim'}
        onClose={() => setSelected(null)}
        footer={editable && selected ? (
          <Btn
            variant="ghost"
            icon={selected.publicado ? 'eye' : 'check'}
            onClick={() => toggle(selected)}
          >
            {selected.publicado ? 'Despublicar' : 'Publicar'}
          </Btn>
        ) : null}
      >
        <DetailFields
          fields={[
            { label: 'Título', value: selected?.titulo },
            { label: 'Subtítulo', value: selected?.subtitulo || '—' },
            { label: 'Autor', value: selected?.usuarios?.nome || '—' },
            { label: 'Data', value: formatDate(selected?.data_publicacao || selected?.created_at) },
            { label: 'Status', value: selected?.publicado ? 'Publicado' : 'Rascunho' },
            { label: 'Texto', value: selected?.texto || '—' },
          ]}
        />
        {selected?.arquivos?.length ? (
          <ul className="manut-docs-grid" style={{ marginTop: 12 }}>
            {selected.arquivos.map((arquivo) => (
              <li key={arquivo.id}>
                <ArquivoPreviewCard arquivo={arquivo} url={arquivo.url} compact />
              </li>
            ))}
          </ul>
        ) : null}
      </Modal>
    </Page>
  );
}
