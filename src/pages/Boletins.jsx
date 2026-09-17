import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { formatDate } from '../lib/format';
import { Alert, Btn, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { DataList, DetailFields, Modal } from '../components/DataList';

export function BoletinsPage() {
  const { condoId, session } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ titulo: '', subtitulo: '', texto: '' });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const { editable, editing, showEditButton, toggleEditing } = useEditTela('manage_boletins');

  async function load() {
    let query = supabase
      .from('boletins_informativos')
      .select('*, usuarios(nome)')
      .eq('condominio_id', condoId)
      .order('created_at', { ascending: false });
    if (!editable) query = query.eq('publicado', true);
    const { data, error: err } = await query;
    if (err) setError(err.message);
    setRows(data || []);
  }
  useEffect(() => { if (condoId) load(); }, [condoId, editable]);

  async function add(e, publicado) {
    e.preventDefault();
    if (!editable) return;
    const payload = {
      p_condominio_id: condoId,
      p_titulo: form.titulo,
      p_subtitulo: form.subtitulo || null,
      p_texto: form.texto,
      p_publicado: publicado,
    };
    const rpc = await supabase.rpc('criar_boletim', payload);
    if (!rpc.error) {
      setForm({ titulo: '', subtitulo: '', texto: '' });
      load();
      return;
    }
    const { error: err } = await supabase.from('boletins_informativos').insert({
      condominio_id: condoId,
      autor_id: session.user.id,
      titulo: form.titulo,
      subtitulo: form.subtitulo,
      texto: form.texto,
      publicado,
      data_publicacao: publicado ? new Date().toISOString() : null,
    });
    if (err) {
      const missingRpc = /could not find the function|schema cache|does not exist/i.test(rpc.error?.message || '');
      setError(missingRpc
        ? 'Rode o arquivo supabase/boletins-rls-fix.sql no SQL Editor do Supabase e tente de novo.'
        : err.message);
    } else {
      setForm({ titulo: '', subtitulo: '', texto: '' });
      load();
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
        ? 'Comunicados do condomínio. O morador vê apenas os itens publicados.'
        : 'Comunicados publicados deste condomínio.'}
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={error} />
      <DataList
        rows={rows}
        empty="Nenhum boletim."
        getTitle={(row) => row.titulo}
        getSubtitle={(row) => [row.subtitulo, row.usuarios?.nome].filter(Boolean).join(' · ')}
        getTags={(row) => [
          row.data_publicacao || row.created_at
            ? { key: 'data', icon: 'calendar', label: formatDate(row.data_publicacao || row.created_at) }
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
          <Field label="Texto"><textarea value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} required /></Field>
          <div className="row">
            <Btn variant="ghost" type="submit" icon="file">Salvar rascunho</Btn>
            <Btn icon="check" onClick={(e) => add(e, true)}>Publicar</Btn>
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
            { label: 'Texto', value: selected?.texto },
          ]}
        />
      </Modal>
    </Page>
  );
}
