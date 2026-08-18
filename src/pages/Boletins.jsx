import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can } from '../lib/permissions';
import { formatDate } from '../lib/format';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';

export function BoletinsPage() {
  const { condoId, cargoTipo, session } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ titulo: '', subtitulo: '', texto: '' });
  const [error, setError] = useState('');
  const canManage = can(cargoTipo, 'manage_boletins');

  async function load() {
    let query = supabase
      .from('boletins_informativos')
      .select('*, usuarios(nome)')
      .eq('condominio_id', condoId)
      .order('created_at', { ascending: false });
    if (!canManage) query = query.eq('publicado', true);
    const { data, error: err } = await query;
    if (err) setError(err.message);
    setRows(data || []);
  }
  useEffect(() => { if (condoId) load(); }, [condoId, canManage]);

  async function add(e, publicado) {
    e.preventDefault();
    if (!canManage) return;
    const { error: err } = await supabase.from('boletins_informativos').insert({
      condominio_id: condoId,
      autor_id: session.user.id,
      titulo: form.titulo,
      subtitulo: form.subtitulo,
      texto: form.texto,
      publicado,
      data_publicacao: publicado ? new Date().toISOString() : null,
    });
    if (err) setError(err.message);
    else {
      setForm({ titulo: '', subtitulo: '', texto: '' });
      load();
    }
  }

  async function toggle(row) {
    if (!canManage) return;
    const publicado = !row.publicado;
    const { error: err } = await supabase.from('boletins_informativos').update({
      publicado,
      data_publicacao: publicado ? new Date().toISOString() : row.data_publicacao,
    }).eq('id', row.id);
    if (err) setError(err.message);
    else load();
  }

  return (
    <Page
      title="Boletins informativos"
      lead={canManage
        ? 'Comunicados do condomínio. O morador vê apenas os itens publicados.'
        : 'Comunicados publicados deste condomínio.'}
    >
      <Alert error={error} />
      <div className="stack">
        {rows.map((row) => (
          <article key={row.id} className="panel">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{row.titulo}</h2>
              {canManage ? (
                <Btn variant="ghost" icon={row.publicado ? 'eye' : 'check'} onClick={() => toggle(row)}>
                  {row.publicado ? 'Despublicar' : 'Publicar'}
                </Btn>
              ) : null}
            </div>
            <p className="muted">{row.subtitulo} · {row.usuarios?.nome} · {formatDate(row.data_publicacao || row.created_at)}</p>
            <p>{row.texto}</p>
          </article>
        ))}
        {!rows.length ? <Empty text="Nenhum boletim." /> : null}
      </div>
      {canManage ? (
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
    </Page>
  );
}
