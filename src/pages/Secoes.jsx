import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can } from '../lib/permissions';
import { Alert, Btn, CoverImage, Empty, Field, Page } from '../components/ui';

export function SecoesPage({ table, title, lead, extra, cover }) {
  const { condoId, cargoTipo, branding } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ titulo: '', texto: '' });
  const [error, setError] = useState('');
  const editable = can(cargoTipo, table === 'sobre_nos' ? 'manage_catalog' : 'manage_content');

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

  return (
    <Page title={title} lead={lead}>
      <Alert error={error} />
      <CoverImage
        src={cover === 'capa' ? (branding?.capa || branding?.visaoGeral) : cover === 'visao' ? (branding?.visaoGeral || branding?.capa) : null}
        alt={title}
      />
      {extra}
      <div className="stack">
        {rows.map((row) => (
          <article key={row.id} className="panel">
            <div className="row" style={{ justifyContent: 'space-between' }}>
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
    </Page>
  );
}
