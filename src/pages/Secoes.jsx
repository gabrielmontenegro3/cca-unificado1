import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { Alert, Btn, CoverHero, CoverImage, Empty, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';

export function SecoesPage({ table, title, lead, extra, cover, hero = false }) {
  const { condoId, branding } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ titulo: '', texto: '' });
  const [error, setError] = useState('');
  const { editable, editing, showEditButton, toggleEditing } = useEditTela(
    table === 'sobre_nos' ? 'manage_catalog' : 'manage_content',
  );
  const coverSrc = cover === 'capa'
    ? (branding?.capa || branding?.visaoGeral)
    : cover === 'visao'
      ? (branding?.visaoGeral || branding?.capa)
      : null;

  async function load() {
    const { data, error: err } = await supabase
      .from(table)
      .select('*')
      .eq('condominio_id', condoId)
      .order('ordem', { ascending: true });
    if (err) setError(err.message);
    setRows(data || []);
  }

  useEffect(() => {
    if (condoId) load();
  }, [condoId, table]);

  async function add(e) {
    e.preventDefault();
    setError('');
    const { error: err } = await supabase.from(table).insert({
      condominio_id: condoId,
      titulo: form.titulo,
      texto: form.texto,
      ordem: rows.length,
    });
    if (err) return setError(err.message);
    setForm({ titulo: '', texto: '' });
    load();
  }

  async function remove(id) {
    const { error: err } = await supabase.from(table).delete().eq('id', id);
    if (err) setError(err.message);
    else load();
  }

  const editAction = showEditButton ? (
    <EditTelaButton editing={editing} onToggle={toggleEditing} />
  ) : null;

  const body = (
    <>
      <Alert error={error} />
      {extra}
      <div className="stack secoes-list">
        {rows.map((row) => (
          <article key={row.id} className="secao-block">
            <div className="secao-block-head">
              <h2>{row.titulo || 'Seção'}</h2>
              {editable ? (
                <Btn variant="ghost" icon="x" onClick={() => remove(row.id)}>Excluir</Btn>
              ) : null}
            </div>
            <p>{row.texto}</p>
          </article>
        ))}
        {!rows.length ? <Empty text="Nenhuma seção cadastrada." /> : null}
      </div>
      {editable ? (
        <form className="panel stack" onSubmit={add} style={{ marginTop: 16 }}>
          <h2>Nova seção</h2>
          <Field label="Título">
            <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required />
          </Field>
          <Field label="Texto">
            <textarea value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} required />
          </Field>
          <Btn type="submit" icon="plus">Adicionar</Btn>
        </form>
      ) : null}
    </>
  );

  if (hero) {
    return (
      <section className="page page-dashboard">
        <div className="cover-hero-wrap">
          <CoverHero src={coverSrc} alt={title} />
        </div>
        <div className="page-head">
          <div className="row page-head-row">
            <h1>{title}</h1>
            {editAction}
          </div>
        </div>
        <div className="page-body">{body}</div>
      </section>
    );
  }

  return (
    <Page title={title} lead={lead} actions={editAction}>
      <CoverImage src={coverSrc} alt={title} />
      {body}
    </Page>
  );
}
