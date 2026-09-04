import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { formatDate, normalizarCnpj } from '../lib/format';
import { Alert, Btn, Field, Page } from '../components/ui';
import { Icon } from '../components/icons';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { DataList, Modal } from '../components/DataList';

const PRAZO_UNIDADES = [
  { value: 'dias', label: 'Dias' },
  { value: 'meses', label: 'Meses' },
  { value: 'anos', label: 'Anos' },
];

const FIELD_LABELS = {
  nome: 'Nome',
  cnpj: 'CNPJ',
  contato: 'Vendedor',
  telefone: 'Telefone',
  telefone1: 'Telefone 1',
  telefone2: 'Telefone 2',
  localizacao: 'Localização',
  descricao: 'Descrição',
  motivos_perda_garantia: 'Perda da garantia',
  prazo_valor: 'Tempo de garantia',
  prazo_unidade: 'Unidade do prazo',
  data_fim: 'Data final da garantia',
};

const FIELD_PLACEHOLDERS = {
  fornecedores: {
    nome: 'Ex.: Acme Revestimentos',
    cnpj: '00.000.000/0000-00',
    contato: 'Nome do vendedor',
    telefone: 'Opcional',
    telefone1: '(11) 3000-0000',
    telefone2: 'Opcional',
    localizacao: 'Cidade / endereço',
  },
  materiais: {
    nome: 'Ex.: Porcelanato 60x60',
  },
  locais: {
    nome: 'Ex.: Hall de entrada',
    descricao: 'Onde o material é utilizado',
  },
  garantias: {
    nome: 'Ex.: Garantia de fábrica',
    prazo_valor: '5',
    motivos_perda_garantia: 'Casos em que a garantia é perdida…',
    descricao: 'Detalhes da cobertura',
    telefone: '(11) 3000-0000',
  },
};

/** Campos sempre exibidos no detalhe, mesmo vazios. */
const DETAIL_ALWAYS = {
  fornecedores: ['nome', 'cnpj', 'localizacao'],
  materiais: ['nome'],
  locais: ['nome', 'descricao'],
  garantias: ['nome', 'prazo_valor', 'data_fim', 'motivos_perda_garantia', 'descricao', 'telefone'],
};

/** Um único cadastro de materiais (= produtos). Sem entidade separada. */
const CONFIG = {
  fornecedores: {
    title: 'Fornecedores',
    fields: ['nome', 'cnpj', 'contato', 'telefone', 'telefone1', 'telefone2', 'localizacao'],
    path: '/fornecedores',
    createTitle: 'Novo fornecedor',
    searchHint: 'Pesquisar por nome, CNPJ, telefone…',
  },
  materiais: {
    title: 'Materiais',
    fields: ['nome'],
    path: '/materiais',
    createTitle: 'Novo material',
    searchHint: 'Pesquisar material…',
  },
  locais: {
    title: 'Locais',
    fields: ['nome', 'descricao'],
    path: '/locais',
    createTitle: 'Novo local',
    searchHint: 'Pesquisar local…',
  },
  garantias: {
    title: 'Garantias',
    fields: ['nome', 'prazo_valor', 'prazo_unidade', 'data_fim', 'motivos_perda_garantia', 'descricao', 'telefone'],
    path: '/garantias',
    createTitle: 'Nova garantia',
    searchHint: 'Pesquisar garantia…',
  },
};

function labelOf(key, table) {
  if (table === 'fornecedores' && key === 'telefone') return 'Telefone do vendedor';
  if (table === 'fornecedores' && key === 'contato') return 'Vendedor';
  return FIELD_LABELS[key] || key.replaceAll('_', ' ');
}

function formatPrazo(valor, unidade) {
  if (valor == null || valor === '') return '';
  const u = String(unidade || '').trim() || 'meses';
  return `${valor} ${u}`;
}

function relatedNome(rel) {
  if (!rel) return '';
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.nome || '';
}

function listSubtitle(table, row) {
  if (table === 'fornecedores') {
    return [row.cnpj, row.telefone1 || row.telefone, row.localizacao].filter(Boolean).join(' · ');
  }
  if (table === 'materiais') {
    return relatedNome(row.fornecedores) || '';
  }
  if (table === 'locais') {
    const desc = String(row.descricao || '').trim();
    if (!desc) return '';
    return desc.length > 80 ? `${desc.slice(0, 80)}…` : desc;
  }
  if (table === 'garantias') {
    const prazo = formatPrazo(row.prazo_valor, row.prazo_unidade);
    const fim = row.data_fim ? `até ${formatDate(row.data_fim)}` : '';
    return [prazo, fim].filter(Boolean).join(' · ');
  }
  return '';
}

function detailFieldsFor(table, row) {
  if (!row) return [];
  const cfg = CONFIG[table];
  const always = new Set(DETAIL_ALWAYS[table] || ['nome']);
  return cfg.fields.map((key) => {
    let value = row[key];
    if (key === 'prazo_valor') {
      value = formatPrazo(row.prazo_valor, row.prazo_unidade) || '';
    } else if (key === 'prazo_unidade') {
      return null;
    } else if (key === 'data_fim') {
      value = value ? formatDate(value) : '';
    } else if (value == null || value === '') {
      value = '';
    } else {
      value = String(value);
    }
    if (!value && !always.has(key)) return null;
    return { label: labelOf(key, table), value: value || '—' };
  }).filter(Boolean);
}

function selectFor(table) {
  if (table === 'materiais') {
    return '*, fornecedores:fornecedor_id(id, nome)';
  }
  return '*';
}

async function loadRelatedGroups(table, id) {
  const groups = [];

  if (table === 'fornecedores') {
    const matsRes = await supabase
      .from('materiais')
      .select('id, nome')
      .eq('fornecedor_id', id)
      .order('nome');
    const mats = matsRes.data || [];

    groups.push({
      key: 'produtos',
      label: 'Produtos',
      items: mats.map((row) => ({
        id: row.id,
        nome: row.nome,
        to: `/materiais/${row.id}`,
      })),
    });

    const matIds = mats.map((m) => m.id);
    const linksByMat = new Map();
    if (matIds.length) {
      const { data: allLinks } = await supabase
        .from('material_garantias')
        .select('material_id, garantia_id, garantias(id, nome, prazo_valor, prazo_unidade, data_fim)')
        .in('material_id', matIds);
      for (const row of allLinks || []) {
        const list = linksByMat.get(row.material_id) || [];
        list.push(row);
        linksByMat.set(row.material_id, list);
      }
    }

    const garantiaPorProduto = mats.map((mat) => {
      const children = (linksByMat.get(mat.id) || [])
        .map((row) => {
          const g = Array.isArray(row.garantias) ? row.garantias[0] : row.garantias;
          if (!g?.id) return null;
          const prazo = formatPrazo(g.prazo_valor, g.prazo_unidade);
          const fim = g.data_fim ? formatDate(g.data_fim) : '';
          const sub = [prazo, fim ? `até ${fim}` : ''].filter(Boolean).join(' · ');
          return {
            id: g.id,
            nome: g.nome || 'Garantia',
            sub: sub || 'Prazo não informado',
            to: `/garantias/${g.id}`,
          };
        })
        .filter(Boolean);
      return {
        id: mat.id,
        nome: mat.nome,
        to: `/materiais/${mat.id}`,
        children: children.length
          ? children
          : [{ id: `${mat.id}-none`, nome: 'Sem garantia vinculada', sub: '', to: null }],
      };
    });

    if (garantiaPorProduto.length) {
      groups.push({
        key: 'garantias_por_produto',
        label: 'Garantias por produto',
        kind: 'nested',
        items: garantiaPorProduto,
      });
    }

    const { data: gars } = await supabase
      .from('fornecedor_garantias')
      .select('garantia_id, garantias(id, nome, prazo_valor, prazo_unidade, data_fim)')
      .eq('fornecedor_id', id);
    groups.push({
      key: 'garantias',
      label: 'Garantias do fornecedor',
      items: (gars || [])
        .map((row) => {
          const g = Array.isArray(row.garantias) ? row.garantias[0] : row.garantias;
          if (!g?.id) return null;
          const prazo = formatPrazo(g.prazo_valor, g.prazo_unidade);
          const fim = g.data_fim ? `até ${formatDate(g.data_fim)}` : '';
          return {
            id: g.id,
            nome: g.nome,
            sub: [prazo, fim].filter(Boolean).join(' · '),
            to: `/garantias/${g.id}`,
          };
        })
        .filter(Boolean),
    });
  }

  if (table === 'materiais') {
    const [locs, gars, mat] = await Promise.all([
      supabase.from('material_locais').select('local_id, locais(id, nome)').eq('material_id', id),
      supabase
        .from('material_garantias')
        .select('garantia_id, garantias(id, nome, prazo_valor, prazo_unidade, data_fim)')
        .eq('material_id', id),
      supabase.from('materiais').select('fornecedor_id, fornecedores:fornecedor_id(id, nome)').eq('id', id).maybeSingle(),
    ]);
    const forn = mat.data?.fornecedores;
    const fornecedor = Array.isArray(forn) ? forn[0] : forn;
    if (fornecedor?.id) {
      groups.push({
        key: 'fornecedor',
        label: 'Fornecedor',
        items: [{ id: fornecedor.id, nome: fornecedor.nome, to: `/fornecedores/${fornecedor.id}` }],
      });
    }
    groups.push({
      key: 'locais',
      label: 'Locais',
      items: (locs.data || [])
        .map((row) => {
          const l = Array.isArray(row.locais) ? row.locais[0] : row.locais;
          if (!l?.id) return null;
          return { id: l.id, nome: l.nome, to: `/locais/${l.id}` };
        })
        .filter(Boolean),
    });
    groups.push({
      key: 'garantias',
      label: 'Garantias',
      items: (gars.data || [])
        .map((row) => {
          const g = Array.isArray(row.garantias) ? row.garantias[0] : row.garantias;
          if (!g?.id) return null;
          const prazo = formatPrazo(g.prazo_valor, g.prazo_unidade);
          const fim = g.data_fim ? `até ${formatDate(g.data_fim)}` : '';
          return {
            id: g.id,
            nome: g.nome,
            sub: [prazo, fim].filter(Boolean).join(' · '),
            to: `/garantias/${g.id}`,
          };
        })
        .filter(Boolean),
    });
  }

  if (table === 'locais') {
    const mats = await supabase
      .from('material_locais')
      .select('material_id, materiais(id, nome)')
      .eq('local_id', id);
    groups.push({
      key: 'produtos',
      label: 'Produtos utilizados no local',
      items: (mats.data || [])
        .map((row) => {
          const m = Array.isArray(row.materiais) ? row.materiais[0] : row.materiais;
          if (!m?.id) return null;
          return { id: m.id, nome: m.nome, to: `/materiais/${m.id}` };
        })
        .filter(Boolean),
    });
  }

  if (table === 'garantias') {
    const [mats, forns] = await Promise.all([
      supabase.from('material_garantias').select('material_id, materiais(id, nome)').eq('garantia_id', id),
      supabase.from('fornecedor_garantias').select('fornecedor_id, fornecedores(id, nome)').eq('garantia_id', id),
    ]);
    groups.push({
      key: 'fornecedores',
      label: 'Fornecedor',
      items: (forns.data || [])
        .map((row) => {
          const f = Array.isArray(row.fornecedores) ? row.fornecedores[0] : row.fornecedores;
          if (!f?.id) return null;
          return { id: f.id, nome: f.nome, to: `/fornecedores/${f.id}` };
        })
        .filter(Boolean),
    });
    groups.push({
      key: 'materiais',
      label: 'Materiais cobertos',
      items: (mats.data || [])
        .map((row) => {
          const m = Array.isArray(row.materiais) ? row.materiais[0] : row.materiais;
          if (!m?.id) return null;
          return { id: m.id, nome: m.nome, to: `/materiais/${m.id}` };
        })
        .filter(Boolean),
    });
  }

  return groups.filter((g) => g.items.length > 0);
}

async function ensureJoin(table, row, conflict) {
  const { error } = await supabase.from(table).upsert(row, {
    onConflict: conflict,
    ignoreDuplicates: true,
  });
  if (error && error.code !== '23505') throw error;
}

async function linkMaterialRelations({ materialId, fornecedorId, localIds = [], garantiaIds = [] }) {
  if (!materialId) return;
  if (fornecedorId) {
    await supabase.from('materiais').update({ fornecedor_id: fornecedorId }).eq('id', materialId);
  }
  for (const localId of localIds) {
    if (!localId) continue;
    await ensureJoin(
      'material_locais',
      { material_id: materialId, local_id: localId },
      'material_id,local_id',
    );
  }
  for (const garantiaId of garantiaIds) {
    if (!garantiaId) continue;
    await ensureJoin(
      'material_garantias',
      { material_id: materialId, garantia_id: garantiaId },
      'material_id,garantia_id',
    );
    if (fornecedorId) {
      await ensureJoin(
        'fornecedor_garantias',
        { fornecedor_id: fornecedorId, garantia_id: garantiaId },
        'fornecedor_id,garantia_id',
      );
    }
  }
}

function MultiCheck({ label, options, values, onChange }) {
  if (!options.length) {
    return (
      <Field label={label}>
        <p className="hint" style={{ margin: 0 }}>Nenhum cadastro disponível ainda.</p>
      </Field>
    );
  }
  return (
    <Field label={label}>
      <div className="catalog-multi">
        {options.map((opt) => {
          const checked = values.includes(opt.id);
          return (
            <label key={opt.id} className={`catalog-multi-item${checked ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  onChange(
                    checked
                      ? values.filter((id) => id !== opt.id)
                      : [...values, opt.id],
                  );
                }}
              />
              <span>{opt.nome}</span>
            </label>
          );
        })}
      </div>
    </Field>
  );
}

function RelatedItemButton({ item, onOpenRelated }) {
  const clickable = Boolean(item?.to);
  const content = (
    <>
      <span className="catalog-related-text">
        <span className="catalog-related-name">{item.nome || 'Sem nome'}</span>
        {item.sub ? <span className="catalog-related-sub">{item.sub}</span> : null}
      </span>
      {clickable ? <Icon name="chevron" size={16} /> : null}
    </>
  );
  if (!clickable) {
    return <div className="catalog-related-item is-static">{content}</div>;
  }
  return (
    <button type="button" className="catalog-related-item" onClick={() => onOpenRelated?.(item)}>
      {content}
    </button>
  );
}

function CatalogDetailView({ fields, relatedGroups, onOpenRelated }) {
  return (
    <div className="catalog-detail">
      {fields?.length ? (
        <dl className="catalog-detail-fields">
          {fields.map((item) => (
            <div key={item.label} className="catalog-detail-field">
              <dt>{item.label}</dt>
              <dd>{item.value == null || item.value === '' ? '—' : item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {relatedGroups?.length ? (
        <div className="catalog-related">
          {relatedGroups.map((group) => (
            <section key={group.key} className="catalog-related-group">
              <h3>{group.label}</h3>
              {group.kind === 'nested' ? (
                <ul className="catalog-related-nested">
                  {group.items.map((parent) => (
                    <li key={`${group.key}-${parent.id}`} className="catalog-related-parent">
                      <RelatedItemButton item={parent} onOpenRelated={onOpenRelated} />
                      <ul>
                        {(parent.children || []).map((child) => (
                          <li key={`${parent.id}-${child.id}`}>
                            <RelatedItemButton item={child} onOpenRelated={onOpenRelated} />
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul>
                  {group.items.map((item) => (
                    <li key={`${group.key}-${item.id}`}>
                      <RelatedItemButton item={item} onOpenRelated={onOpenRelated} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : (
        <p className="catalog-related-empty">Nenhum vínculo cadastrado ainda.</p>
      )}
    </div>
  );
}

function FormField({ table, col, form, setForm }) {
  const label = labelOf(col, table);
  const required = col === 'nome';
  const placeholder = FIELD_PLACEHOLDERS[table]?.[col];

  if (col === 'prazo_unidade') {
    return (
      <Field label={label}>
        <select
          value={form.prazo_unidade || 'anos'}
          onChange={(e) => setForm({ ...form, prazo_unidade: e.target.value })}
        >
          {PRAZO_UNIDADES.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
      </Field>
    );
  }

  if (col === 'prazo_valor') {
    return (
      <Field label={label}>
        <input
          type="number"
          min="0"
          step="1"
          value={form.prazo_valor || ''}
          onChange={(e) => setForm({ ...form, prazo_valor: e.target.value })}
          placeholder={placeholder || 'Ex.: 5'}
        />
      </Field>
    );
  }

  if (col === 'data_fim') {
    return (
      <Field label={label}>
        <input
          type="date"
          value={form.data_fim || ''}
          onChange={(e) => setForm({ ...form, data_fim: e.target.value })}
        />
      </Field>
    );
  }

  if (col.includes('descricao') || col.includes('motivos') || col === 'localizacao') {
    return (
      <Field label={label}>
        <textarea
          value={form[col] || ''}
          onChange={(e) => setForm({ ...form, [col]: e.target.value })}
          placeholder={placeholder}
        />
      </Field>
    );
  }

  return (
    <Field label={label}>
      <input
        value={form[col] || ''}
        onChange={(e) => setForm({ ...form, [col]: e.target.value })}
        required={required}
        placeholder={placeholder}
      />
    </Field>
  );
}

export function CatalogList({ table }) {
  const navigate = useNavigate();
  const { condoId } = useSession();
  const cfg = CONFIG[table];
  const [rows, setRows] = useState([]);
  const [options, setOptions] = useState({
    fornecedores: [],
    materiais: [],
    locais: [],
    garantias: [],
  });
  const [q, setQ] = useState('');
  const [form, setForm] = useState({});
  const [links, setLinks] = useState({
    fornecedorId: '',
    materialIds: [],
    localIds: [],
    garantiaIds: [],
  });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [relatedGroups, setRelatedGroups] = useState([]);
  const { editable, editing, showEditButton, canRole, toggleEditing } = useEditTela('manage_catalog');

  async function load() {
    const { data, error: err } = await supabase
      .from(table)
      .select(selectFor(table))
      .eq('condominio_id', condoId)
      .order('nome');
    if (err) setError(err.message);
    setRows(data || []);
  }

  async function loadOptions() {
    const [f, m, l, g] = await Promise.all([
      supabase.from('fornecedores').select('id, nome').eq('condominio_id', condoId).order('nome'),
      supabase.from('materiais').select('id, nome').eq('condominio_id', condoId).order('nome'),
      supabase.from('locais').select('id, nome').eq('condominio_id', condoId).order('nome'),
      supabase.from('garantias').select('id, nome').eq('condominio_id', condoId).order('nome'),
    ]);
    setOptions({
      fornecedores: f.data || [],
      materiais: m.data || [],
      locais: l.data || [],
      garantias: g.data || [],
    });
  }

  useEffect(() => {
    if (!condoId) return;
    load();
    loadOptions();
  }, [condoId, table]);

  useEffect(() => {
    if (!selected?.id) {
      setRelatedGroups([]);
      return undefined;
    }
    let cancelled = false;
    loadRelatedGroups(table, selected.id).then((groups) => {
      if (!cancelled) setRelatedGroups(groups);
    });
    return () => { cancelled = true; };
  }, [selected?.id, table]);

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      const payload = { condominio_id: condoId };
      for (const col of cfg.fields) {
        if (col === 'prazo_unidade' && table === 'garantias') {
          payload.prazo_unidade = String(form.prazo_unidade || 'anos').trim().slice(0, 32);
          continue;
        }
        const raw = form[col];
        if (raw == null || raw === '') continue;
        payload[col] = raw;
      }

      if (table === 'locais') payload.tipo = 'outro';
      if (table === 'materiais' && links.fornecedorId) {
        payload.fornecedor_id = links.fornecedorId;
      }
      if (table === 'fornecedores' && payload.cnpj != null) {
        payload.cnpj = normalizarCnpj(payload.cnpj);
      }
      if (table === 'garantias' && payload.prazo_valor != null && payload.prazo_valor !== '') {
        payload.prazo_valor = Number(payload.prazo_valor);
      }

      const { data, error: err } = await supabase.from(table).insert(payload).select('id').single();
      if (err) throw err;
      const newId = data?.id;

      if (table === 'materiais' && newId) {
        await linkMaterialRelations({
          materialId: newId,
          fornecedorId: links.fornecedorId || null,
          localIds: links.localIds,
          garantiaIds: links.garantiaIds,
        });
      }

      if (table === 'garantias' && newId) {
        for (const materialId of links.materialIds) {
          await linkMaterialRelations({
            materialId,
            fornecedorId: links.fornecedorId || null,
            garantiaIds: [newId],
          });
        }
        if (links.fornecedorId && !links.materialIds.length) {
          await ensureJoin(
            'fornecedor_garantias',
            { fornecedor_id: links.fornecedorId, garantia_id: newId },
            'fornecedor_id,garantia_id',
          );
        }
      }

      if (table === 'locais' && newId) {
        for (const materialId of links.materialIds) {
          await linkMaterialRelations({
            materialId,
            localIds: [newId],
          });
        }
      }

      if (table === 'fornecedores' && newId) {
        for (const materialId of links.materialIds) {
          await supabase.from('materiais').update({ fornecedor_id: newId }).eq('id', materialId);
          for (const garantiaId of links.garantiaIds) {
            await ensureJoin(
              'material_garantias',
              { material_id: materialId, garantia_id: garantiaId },
              'material_id,garantia_id',
            );
          }
        }
        for (const garantiaId of links.garantiaIds) {
          await ensureJoin(
            'fornecedor_garantias',
            { fornecedor_id: newId, garantia_id: garantiaId },
            'fornecedor_id,garantia_id',
          );
        }
      }

      setForm({});
      setLinks({ fornecedorId: '', materialIds: [], localIds: [], garantiaIds: [] });
      await Promise.all([load(), loadOptions()]);
    } catch (err) {
      setError(err.message || 'Não foi possível salvar.');
    }
  }

  const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q.toLowerCase()));
  const detailFields = selected ? detailFieldsFor(table, selected) : [];

  function openRelated(item) {
    if (!item?.to) return;
    setSelected(null);
    navigate(item.to);
  }

  return (
    <Page
      title={cfg.title}
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={error} />
      <input placeholder={cfg.searchHint || 'Pesquisar'} value={q} onChange={(e) => setQ(e.target.value)} />
      <DataList
        rows={filtered}
        empty="Nenhum registro."
        getTitle={(row) => row.nome || 'Sem nome'}
        getSubtitle={(row) => listSubtitle(table, row)}
        onSelect={setSelected}
      />

      {editable ? (
        <form className="panel stack catalog-form" onSubmit={add}>
          <h2>{cfg.createTitle}</h2>
          {cfg.fields.map((col) => (
            <FormField key={col} table={table} col={col} form={form} setForm={setForm} />
          ))}

          {table === 'materiais' ? (
            <>
              <Field label="Fornecedor">
                <select
                  value={links.fornecedorId}
                  onChange={(e) => setLinks({ ...links, fornecedorId: e.target.value })}
                >
                  <option value="">Sem fornecedor</option>
                  {options.fornecedores.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.nome}</option>
                  ))}
                </select>
              </Field>
              <MultiCheck
                label="Garantias"
                options={options.garantias}
                values={links.garantiaIds}
                onChange={(garantiaIds) => setLinks({ ...links, garantiaIds })}
              />
              <MultiCheck
                label="Locais"
                options={options.locais}
                values={links.localIds}
                onChange={(localIds) => setLinks({ ...links, localIds })}
              />
            </>
          ) : null}

          {table === 'garantias' ? (
            <>
              <Field label="Fornecedor">
                <select
                  value={links.fornecedorId}
                  onChange={(e) => setLinks({ ...links, fornecedorId: e.target.value })}
                >
                  <option value="">Sem fornecedor</option>
                  {options.fornecedores.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.nome}</option>
                  ))}
                </select>
              </Field>
              <MultiCheck
                label="Materiais cobertos"
                options={options.materiais}
                values={links.materialIds}
                onChange={(materialIds) => setLinks({ ...links, materialIds })}
              />
            </>
          ) : null}

          {table === 'locais' ? (
            <MultiCheck
              label="Produtos utilizados no local"
              options={options.materiais}
              values={links.materialIds}
              onChange={(materialIds) => setLinks({ ...links, materialIds })}
            />
          ) : null}

          {table === 'fornecedores' ? (
            <>
              <MultiCheck
                label="Produtos deste fornecedor"
                options={options.materiais}
                values={links.materialIds}
                onChange={(materialIds) => setLinks({ ...links, materialIds })}
              />
              <MultiCheck
                label="Garantias (aplicadas aos produtos selecionados)"
                options={options.garantias}
                values={links.garantiaIds}
                onChange={(garantiaIds) => setLinks({ ...links, garantiaIds })}
              />
            </>
          ) : null}

          <Btn type="submit" icon="check">Salvar</Btn>
        </form>
      ) : !canRole ? (
        <p className="hint" style={{ marginTop: 16 }}>
          Somente leitura. A Gestão Técnica e o administrador cadastram os registros.
        </p>
      ) : null}

      <Modal
        open={Boolean(selected)}
        title={selected?.nome || cfg.title}
        onClose={() => setSelected(null)}
        className="modal-sheet--catalog"
      >
        <CatalogDetailView
          fields={detailFields}
          relatedGroups={relatedGroups}
          onOpenRelated={openRelated}
        />
      </Modal>
    </Page>
  );
}

export function CatalogDetail({ table }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [relatedGroups, setRelatedGroups] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.from(table).select('*').eq('id', id).single();
      if (err) return setError(err.message);
      setRow(data);
      setRelatedGroups(await loadRelatedGroups(table, id));
    })();
  }, [id, table]);

  if (!row) return <Page title="Detalhe"><Alert error={error} /></Page>;

  return (
    <Page title={row.nome}>
      <Alert error={error} />
      <CatalogDetailView
        fields={detailFieldsFor(table, row)}
        relatedGroups={relatedGroups}
        onOpenRelated={(item) => item?.to && navigate(item.to)}
      />
      <div style={{ marginTop: 16 }}>
        <Btn variant="ghost" onClick={() => navigate(CONFIG[table].path)}>
          Voltar à lista
        </Btn>
      </div>
    </Page>
  );
}
