import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can } from '../lib/permissions';
import { uploadArquivo, publicOrSignedUrl } from '../lib/api';
import { formatDate } from '../lib/format';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';

export function DocumentosPage() {
  const { condoId, cargoTipo, session } = useSession();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ titulo: '', descricao: '', file: null });
  const [error, setError] = useState('');
  const editable = can(cargoTipo, 'manage_content');

  async function load() {
    const { data, error: err } = await supabase
      .from('documentos_empreendimento')
      .select('*, arquivos(*)')
      .eq('condominio_id', condoId)
      .order('ordem');
    if (err) setError(err.message);
    setRows(data || []);
  }

  useEffect(() => { if (condoId) load(); }, [condoId]);

  async function add(e) {
    e.preventDefault();
    if (!form.file) return setError('Selecione um arquivo.');
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
        titulo: form.titulo,
        descricao: form.descricao,
        ordem: rows.length,
      });
      if (err) throw err;
      setForm({ titulo: '', descricao: '', file: null });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function openFile(path) {
    const { data, error: err } = await publicOrSignedUrl(path);
    if (err) setError(err.message);
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  const filtered = rows.filter((r) => `${r.titulo} ${r.descricao || ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Page title="Documentos" lead="Arquivos do empreendimento. O arquivo físico fica no Storage.">
      <Alert error={error} />
      <input placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="table-wrap panel" style={{ marginTop: 16 }}>
        {!filtered.length ? <Empty text="Nenhum documento." /> : (
          <table>
            <thead><tr><th>Título</th><th>Descrição</th><th>Data</th><th></th></tr></thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>{row.titulo}</td>
                  <td>{row.descricao || '—'}</td>
                  <td>{formatDate(row.created_at)}</td>
                  <td>
                    <Btn variant="ghost" icon="file" onClick={() => openFile(row.arquivos?.storage_path)}>
                      Abrir
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editable ? (
        <form className="panel stack" onSubmit={add} style={{ marginTop: 16 }}>
          <h2>Novo documento</h2>
          <Field label="Título"><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required /></Field>
          <Field label="Descrição"><input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></Field>
          <Field label="Arquivo"><input type="file" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} /></Field>
          <Btn type="submit" icon="paperclip">Enviar</Btn>
        </form>
      ) : null}
    </Page>
  );
}

export function ContatosPage() {
  const { condoId, cargoTipo } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ nome: '', subtitulo: '', telefone: '', email: '' });
  const [error, setError] = useState('');
  const editable = can(cargoTipo, 'manage_catalog');

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

  return (
    <Page title="Contatos" lead="Contatos úteis do condomínio.">
      <Alert error={error} />
      <div className="grid grid-3">
        {rows.filter((r) => r.ativo).map((row) => (
          <article key={row.id} className="panel">
            <h2>{row.nome}</h2>
            <p className="muted">{row.subtitulo}</p>
            <p>{row.telefone}</p>
            <p>{row.email}</p>
          </article>
        ))}
      </div>
      {!rows.length ? <Empty text="Nenhum contato." /> : null}
      {editable ? (
        <form className="panel stack" onSubmit={add} style={{ marginTop: 16 }}>
          <h2>Novo contato</h2>
          <Field label="Nome"><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required /></Field>
          <Field label="Subtítulo"><input value={form.subtitulo} onChange={(e) => setForm({ ...form, subtitulo: e.target.value })} /></Field>
          <Field label="Telefone"><input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></Field>
          <Field label="E-mail"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Btn type="submit" icon="check">Salvar</Btn>
        </form>
      ) : null}
    </Page>
  );
}
