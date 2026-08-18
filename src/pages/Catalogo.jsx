import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can, TIPO_LOCAL } from '../lib/permissions';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';

const CONFIG = {
  fornecedores: {
    title: 'Fornecedores',
    fields: ['nome', 'cnpj', 'contato', 'telefone', 'email', 'cidade', 'estado', 'descricao', 'endereco'],
    list: ['nome', 'cnpj', 'telefone', 'email', 'cidade'],
  },
  materiais: {
    title: 'Materiais',
    fields: ['nome', 'codigo', 'fabricante', 'modelo', 'descricao'],
    list: ['nome', 'codigo', 'fabricante', 'modelo'],
  },
  locais: {
    title: 'Locais',
    fields: ['nome', 'tipo', 'bloco', 'descricao'],
    list: ['nome', 'tipo', 'bloco'],
  },
  garantias: {
    title: 'Garantias',
    fields: ['nome', 'descricao', 'motivos_perda_garantia', 'prazo_valor', 'prazo_unidade', 'data_inicio', 'data_fim'],
    list: ['nome', 'data_inicio', 'data_fim'],
  },
};

export function CatalogList({ table }) {
  const { condoId, cargoTipo } = useSession();
  const cfg = CONFIG[table];
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const editable = can(cargoTipo, 'manage_catalog');

  async function load() {
    const { data, error: err } = await supabase.from(table).select('*').eq('condominio_id', condoId).order('nome');
    if (err) setError(err.message);
    setRows(data || []);
  }
  useEffect(() => { if (condoId) load(); }, [condoId, table]);

  async function add(e) {
    e.preventDefault();
    const payload = { ...form, condominio_id: condoId };
    if (table === 'locais' && !payload.tipo) payload.tipo = 'outro';
    const { error: err } = await supabase.from(table).insert(payload);
    if (err) setError(err.message);
    else {
      setForm({});
      load();
    }
  }

  const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q.toLowerCase()));

  return (
    <Page title={cfg.title} lead="Base técnica do empreendimento.">
      <Alert error={error} />
      <input placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="table-wrap panel" style={{ marginTop: 16 }}>
        {!filtered.length ? <Empty text="Nenhum registro." /> : (
          <table>
            <thead>
              <tr>
                {cfg.list.map((col) => <th key={col}>{col}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  {cfg.list.map((col) => <td key={col}>{col === 'tipo' ? (TIPO_LOCAL[row[col]] || row[col]) : (row[col] || '—')}</td>)}
                  <td><Link to={`/${table}/${row.id}`}>Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editable ? (
        <form className="panel stack" onSubmit={add} style={{ marginTop: 16 }}>
          <h2>Novo</h2>
          {cfg.fields.map((col) => (
            <Field key={col} label={col.replaceAll('_', ' ')}>
              {col === 'tipo' ? (
                <select value={form.tipo || 'outro'} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                  {Object.entries(TIPO_LOCAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              ) : col.includes('descricao') || col.includes('motivos') ? (
                <textarea value={form[col] || ''} onChange={(e) => setForm({ ...form, [col]: e.target.value })} />
              ) : (
                <input value={form[col] || ''} onChange={(e) => setForm({ ...form, [col]: e.target.value })} required={col === 'nome'} />
              )}
            </Field>
          ))}
          <Btn type="submit" icon="check">Salvar</Btn>
        </form>
      ) : (
        <p className="hint" style={{ marginTop: 16 }}>Somente leitura. A Gestão Técnica e o administrador cadastram os registros.</p>
      )}
    </Page>
  );
}

export function CatalogDetail({ table }) {
  const { id } = useParams();
  const [row, setRow] = useState(null);
  const [related, setRelated] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.from(table).select('*').eq('id', id).single();
      if (err) return setError(err.message);
      setRow(data);
      if (table === 'fornecedores') {
        const mats = await supabase.from('materiais').select('*').eq('fornecedor_id', id);
        setRelated(mats.data || []);
      }
      if (table === 'materiais') {
        const locs = await supabase.from('material_locais').select('*, locais(nome)').eq('material_id', id);
        setRelated(locs.data || []);
      }
      if (table === 'locais') {
        const mats = await supabase.from('material_locais').select('*, materiais(nome)').eq('local_id', id);
        setRelated(mats.data || []);
      }
      if (table === 'garantias') {
        const mats = await supabase.from('material_garantias').select('*, materiais(nome)').eq('garantia_id', id);
        setRelated(mats.data || []);
      }
    })();
  }, [id, table]);

  if (!row) return <Page title="Detalhe"><Alert error={error} /></Page>;

  return (
    <Page title={row.nome} lead={CONFIG[table].title}>
      <Alert error={error} />
      <section className="panel stack">
        {Object.entries(row).filter(([k]) => !['id', 'condominio_id', 'created_at', 'updated_at'].includes(k)).map(([k, v]) => (
          <p key={k}><strong>{k.replaceAll('_', ' ')}:</strong> {String(v ?? '—')}</p>
        ))}
      </section>
      {related.length ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Relacionados</h2>
          <ul>
            {related.map((item) => (
              <li key={item.id}>{item.nome || item.locais?.nome || item.materiais?.nome}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </Page>
  );
}
