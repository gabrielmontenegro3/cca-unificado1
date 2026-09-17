import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { publicOrSignedUrl, salvarLogoFornecedor } from '../lib/api';
import { formatCnpj, formatDate, formatTelefone, normalizarCnpj } from '../lib/format';
import { Alert, Btn, Field, MaskedInput, Page } from '../components/ui';
import { Icon } from '../components/icons';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { DataList, Modal } from '../components/DataList';
import { AREA_LOCAL } from '../lib/permissions';
import { areaForLocal, iconForLocal, tipoForLocal } from '../lib/localIcon';

const PRAZO_UNIDADES = [
  { value: 'dias', label: 'Dias' },
  { value: 'meses', label: 'Meses' },
  { value: 'anos', label: 'Anos' },
];

const FIELD_LABELS = {
  nome: 'Nome',
  razao_social: 'Razão social',
  nome_fantasia: 'Nome fantasia',
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
  area: 'Área',
};

const FIELD_PLACEHOLDERS = {
  fornecedores: {
    razao_social: 'Ex.: Acme Revestimentos Ltda',
    nome_fantasia: 'Ex.: Acme Revestimentos',
    cnpj: '00.000.000/0000-00',
    contato: 'Nome do vendedor',
    telefone: '(11) 90000-0000',
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
  fornecedores: ['razao_social', 'nome_fantasia', 'cnpj', 'localizacao'],
  materiais: ['nome'],
  locais: ['nome', 'descricao', 'area'],
  garantias: ['nome', 'prazo_valor', 'data_fim', 'motivos_perda_garantia', 'descricao', 'telefone'],
};

/** Um único cadastro de materiais (= produtos). Sem entidade separada. */
const CONFIG = {
  fornecedores: {
    title: 'Fornecedores',
    fields: ['razao_social', 'nome_fantasia', 'cnpj', 'contato', 'telefone', 'telefone1', 'telefone2', 'localizacao'],
    path: '/fornecedores',
    createTitle: 'Novo fornecedor',
    searchHint: 'Pesquisar por razão social, nome fantasia, CNPJ, telefone…',
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
    fields: ['nome', 'descricao', 'area'],
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

function isMissingColumnError(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || error?.details || '');
  return code === 'PGRST204'
    || /schema cache/i.test(msg)
    || /could not find the '[^']+' column/i.test(msg)
    || /column .+ does not exist/i.test(msg);
}

function columnNameFromError(error) {
  const msg = String(error?.message || error?.details || '');
  const match = msg.match(/'([a-z0-9_]+)' column/i) || msg.match(/column\s+"([a-z0-9_]+)"/i);
  return match?.[1] || '';
}

async function insertCatalogRow(table, payload) {
  const optional = table === 'fornecedores'
    ? ['razao_social', 'nome_fantasia', 'telefone1', 'telefone2', 'localizacao', 'contato', 'logo_path']
    : table === 'garantias'
      ? ['telefone', 'prazo_valor', 'prazo_unidade', 'data_fim', 'motivos_perda_garantia']
      : table === 'locais'
        ? ['area']
        : [];
  const body = { ...payload };
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(body).select('id').maybeSingle();
    if (!error || data?.id) return data;
    lastError = error;
    if (!isMissingColumnError(error)) throw error;
    const col = columnNameFromError(error);
    if (col && Object.prototype.hasOwnProperty.call(body, col)) {
      delete body[col];
      continue;
    }
    const next = optional.find((key) => Object.prototype.hasOwnProperty.call(body, key));
    if (!next) throw error;
    delete body[next];
  }
  throw lastError || new Error('Não foi possível salvar.');
}

function relatedNome(rel) {
  if (!rel) return '';
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.nome || '';
}

async function withLogoUrls(rows) {
  return Promise.all((rows || []).map(async (row) => {
    if (!row?.logo_path) return { ...row, logoUrl: '' };
    try {
      const { data } = await publicOrSignedUrl(row.logo_path);
      return { ...row, logoUrl: data?.signedUrl || '' };
    } catch {
      return { ...row, logoUrl: '' };
    }
  }));
}

function fornecedorTags(row) {
  if (!row) return [];
  const phones = [...new Set([row.telefone1, row.telefone, row.telefone2].filter(Boolean))];
  return [
    row.contato ? { key: 'contato', icon: 'user', label: row.contato } : null,
    ...phones.map((phone, index) => ({ key: `tel-${index}`, icon: 'phone', label: formatTelefone(phone) || phone })),
    row.localizacao ? { key: 'loc', icon: 'map', label: row.localizacao } : null,
  ].filter(Boolean);
}

function catalogTags(table, row) {
  if (!row) return [];
  if (table === 'fornecedores') return fornecedorTags(row);
  if (table === 'materiais') {
    const forn = relatedNome(row.fornecedores);
    return forn ? [{ key: 'forn', icon: 'box', label: forn }] : [];
  }
  if (table === 'locais') {
    const desc = String(row.descricao || '').trim();
    const area = AREA_LOCAL[row.area] || '';
    return [
      area ? { key: 'area', icon: row.area === 'privativa' ? 'home' : 'building', label: area } : null,
      desc ? {
        key: 'desc',
        icon: iconForLocal(row.nome, row.descricao),
        label: desc.length > 72 ? `${desc.slice(0, 72)}…` : desc,
      } : null,
    ].filter(Boolean);
  }
  if (table === 'garantias') {
    const prazo = formatPrazo(row.prazo_valor, row.prazo_unidade);
    return [
      prazo ? { key: 'prazo', icon: 'shield', label: prazo } : null,
      row.data_fim ? { key: 'fim', icon: 'calendar', label: `até ${formatDate(row.data_fim)}` } : null,
      row.telefone ? { key: 'tel', icon: 'phone', label: formatTelefone(row.telefone) || row.telefone } : null,
    ].filter(Boolean);
  }
  return [];
}

function listTitle(table, row) {
  if (!row) return '';
  if (table === 'fornecedores') return row.nome_fantasia || row.nome || 'Sem nome';
  return row.nome || 'Sem nome';
}

function listSubtitle(table, row) {
  if (!row) return '';
  if (table === 'fornecedores') {
    return formatCnpj(row.cnpj) || '';
  }
  if (table === 'locais') {
    return AREA_LOCAL[row.area] || '';
  }
  if (table === 'garantias') {
    const desc = String(row.descricao || '').trim();
    if (!desc) return '';
    return desc.length > 72 ? `${desc.slice(0, 72)}…` : desc;
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
    } else if (key === 'cnpj') {
      value = formatCnpj(value) || '';
    } else if (key === 'area') {
      value = AREA_LOCAL[value] || '';
    } else if (String(key).startsWith('telefone')) {
      value = formatTelefone(value) || '';
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

function parseCatalogLink(to) {
  const match = String(to || '').match(/^\/(fornecedores|materiais|locais|garantias)\/([^/?#]+)/);
  if (!match) return null;
  return { table: match[1], id: match[2] };
}

async function loadCatalogRow(tableName, id) {
  const { data, error } = await supabase.from(tableName).select(selectFor(tableName)).eq('id', id).single();
  if (error) throw error;
  if (tableName === 'fornecedores') {
    const [withLogo] = await withLogoUrls([data]);
    return withLogo;
  }
  return data;
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
          return { id: l.id, nome: l.nome, to: `/locais/${l.id}`, icon: iconForLocal(l.nome) };
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

function MultiCheck({ label, options, values, onChange, withLocalIcons = false }) {
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
              {withLocalIcons ? (
                <div className="catalog-multi-icon" aria-hidden="true">
                  <Icon name={iconForLocal(opt.nome)} size={16} />
                </div>
              ) : null}
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
      {item.icon ? (
        <span className="catalog-related-icon" aria-hidden="true">
          <Icon name={item.icon} size={18} />
        </span>
      ) : null}
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

function CatalogDetailView({ fields, relatedGroups, onOpenRelated, logoUrl, iconName }) {
  return (
    <div className="catalog-detail">
      {logoUrl ? (
        <div className="forn-detail-logo">
          <img src={logoUrl} alt="" />
        </div>
      ) : iconName ? (
        <div className="local-detail-icon" aria-hidden="true">
          <Icon name={iconName} size={32} />
        </div>
      ) : null}
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
  const required = col === 'nome' || col === 'razao_social' || col === 'nome_fantasia';
  const placeholder = FIELD_PLACEHOLDERS[table]?.[col];
  const setValue = (value) => setForm({ ...form, [col]: value });

  if (table === 'locais' && col === 'nome') {
    return (
      <Field label={label}>
        <div className="local-name-field">
          <div className="local-name-icon" aria-hidden="true">
            <Icon name={iconForLocal(form.nome, form.descricao)} size={20} />
          </div>
          <input
            value={form.nome || ''}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            required={required}
            placeholder={placeholder}
          />
        </div>
      </Field>
    );
  }

  if (table === 'locais' && col === 'area') {
    return (
      <Field label="Área">
        <div className="area-local-options">
          {[
            { id: 'privativa', hint: 'Itens deste local só aparecem para moradores.' },
            { id: 'comum', hint: 'Itens deste local só aparecem para a Administração do condomínio.' },
          ].map((opt) => (
            <label key={opt.id} className={`area-local-option${form.area === opt.id ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="local-area"
                value={opt.id}
                checked={form.area === opt.id}
                onChange={() => setForm({ ...form, area: opt.id })}
                required
              />
              <span>
                <strong>{AREA_LOCAL[opt.id]}</strong>
                <small>{opt.hint}</small>
              </span>
            </label>
          ))}
        </div>
      </Field>
    );
  }

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
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
        />
      </Field>
    );
  }

  if (col === 'cnpj') {
    return (
      <Field label={label}>
        <MaskedInput
          mask="cnpj"
          value={form[col] || ''}
          onChange={setValue}
          placeholder={placeholder}
        />
      </Field>
    );
  }

  if (String(col).startsWith('telefone')) {
    return (
      <Field label={label}>
        <MaskedInput
          mask="telefone"
          value={form[col] || ''}
          onChange={setValue}
          placeholder={placeholder}
        />
      </Field>
    );
  }

  return (
    <Field label={label}>
      <input
        value={form[col] || ''}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        placeholder={placeholder}
      />
    </Field>
  );
}

export function CatalogList({ table }) {
  const { condoId, session } = useSession();
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
  const [logoFile, setLogoFile] = useState(null);
  const [links, setLinks] = useState({
    fornecedorId: '',
    materialIds: [],
    localIds: [],
    garantiaIds: [],
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [detail, setDetail] = useState(null);
  const [detailStack, setDetailStack] = useState([]);
  const [relatedGroups, setRelatedGroups] = useState([]);
  const { editable, editing, showEditButton, canRole, toggleEditing } = useEditTela('manage_catalog');

  async function load() {
    const { data, error: err } = await supabase
      .from(table)
      .select(selectFor(table))
      .eq('condominio_id', condoId)
      .order('nome');
    if (err) setError(err.message);
    setRows(table === 'fornecedores' ? await withLogoUrls(data || []) : (data || []));
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
    if (!detail?.row?.id) {
      setRelatedGroups([]);
      return undefined;
    }
    let cancelled = false;
    loadRelatedGroups(detail.table, detail.row.id).then((groups) => {
      if (!cancelled) setRelatedGroups(groups);
    });
    return () => { cancelled = true; };
  }, [detail?.row?.id, detail?.table]);

  async function add(e) {
    e.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
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

      if (table === 'locais') {
        payload.tipo = tipoForLocal(form.nome, form.descricao);
        payload.area = areaForLocal(form.nome, form.descricao, form.area);
        if (!form.area) throw new Error('Informe se o local é área privativa ou área comum.');
      }
      if (table === 'materiais' && links.fornecedorId) {
        payload.fornecedor_id = links.fornecedorId;
      }
      if (table === 'fornecedores') {
        const razao = String(form.razao_social || '').trim();
        const fantasia = String(form.nome_fantasia || '').trim();
        if (!razao) throw new Error('Informe a razão social.');
        if (!fantasia) throw new Error('Informe o nome fantasia.');
        payload.razao_social = razao;
        payload.nome_fantasia = fantasia;
        payload.nome = fantasia;
        if (payload.cnpj != null) payload.cnpj = normalizarCnpj(payload.cnpj);
        for (const key of ['telefone', 'telefone1', 'telefone2']) {
          if (payload[key]) payload[key] = formatTelefone(payload[key]);
        }
      }
      if (table === 'garantias' && payload.prazo_valor != null && payload.prazo_valor !== '') {
        payload.prazo_valor = Number(payload.prazo_valor);
      }
      if (table === 'garantias' && payload.telefone) {
        payload.telefone = formatTelefone(payload.telefone);
      }

      const data = await insertCatalogRow(table, payload);
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
        if (logoFile) {
          await salvarLogoFornecedor({
            condominioId: condoId,
            userId: session.user.id,
            fornecedorId: newId,
            file: logoFile,
          });
        }
      }

      setForm({});
      setLogoFile(null);
      setLinks({ fornecedorId: '', materialIds: [], localIds: [], garantiaIds: [] });
      await Promise.all([load(), loadOptions()]);
    } catch (err) {
      setError(err.message || 'Não foi possível salvar.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q.toLowerCase()));
  const selected = detail?.row || null;
  const detailTable = detail?.table || table;
  const detailFields = selected ? detailFieldsFor(detailTable, selected) : [];

  function openRecord(row) {
    setDetailStack([]);
    setDetail({ table, row });
  }

  async function openRelated(item) {
    const link = parseCatalogLink(item?.to);
    if (!link) return;
    try {
      setError('');
      const row = await loadCatalogRow(link.table, link.id);
      setDetailStack((stack) => (detail ? [...stack, detail] : stack));
      setDetail({ table: link.table, row });
    } catch (err) {
      setError(err.message || 'Não foi possível abrir o registro.');
    }
  }

  function closeDetail() {
    if (detailStack.length) {
      const prev = detailStack[detailStack.length - 1];
      setDetailStack(detailStack.slice(0, -1));
      setDetail(prev);
      return;
    }
    setDetail(null);
  }

  return (
    <Page
      title={cfg.title}
      search={{
        value: q,
        onChange: setQ,
        placeholder: cfg.searchHint || 'Procurar registro…',
      }}
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={error} />
      <div className="catalog-list">
        <DataList
          rows={filtered}
          empty={q ? 'Nenhum registro encontrado.' : 'Nenhum registro.'}
          getTitle={(row) => listTitle(table, row)}
          getSubtitle={(row) => listSubtitle(table, row)}
          getLeading={table === 'fornecedores'
            ? (row) => (row.logoUrl
              ? <img src={row.logoUrl} alt="" />
              : <Icon name="box" size={18} />)
            : table === 'locais'
              ? (row) => <Icon name={iconForLocal(row.nome, row.descricao)} size={20} />
              : undefined}
          getTags={(row) => catalogTags(table, row)}
          onSelect={openRecord}
        />
      </div>

      {editable ? (
        <form className="panel stack catalog-form" onSubmit={add}>
          <h2>{cfg.createTitle}</h2>
          {table === 'fornecedores' ? (
            <>
              <div className="catalog-form-grid">
                <FormField table={table} col="razao_social" form={form} setForm={setForm} />
                <FormField table={table} col="nome_fantasia" form={form} setForm={setForm} />
              </div>
              {['cnpj', 'contato', 'telefone'].map((col) => (
                <FormField key={col} table={table} col={col} form={form} setForm={setForm} />
              ))}
              <div className="catalog-form-grid">
                <FormField table={table} col="telefone1" form={form} setForm={setForm} />
                <FormField table={table} col="telefone2" form={form} setForm={setForm} />
              </div>
              <FormField table={table} col="localizacao" form={form} setForm={setForm} />
            </>
          ) : (
            cfg.fields.map((col) => (
              <FormField key={col} table={table} col={col} form={form} setForm={setForm} />
            ))
          )}
          {table === 'fornecedores' ? (
            <div className="field">
              <span>Logo da empresa</span>
              <label className="catalog-file-pick">
                {logoFile ? 'Trocar logo' : 'Enviar logo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/*"
                  onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                />
              </label>
              {logoFile ? <span className="hint catalog-file-name">{logoFile.name}</span> : null}
            </div>
          ) : null}

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
                withLocalIcons
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

          <Btn type="submit" icon="check" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Btn>
        </form>
      ) : !canRole ? (
        <p className="hint" style={{ marginTop: 16 }}>
          Somente leitura. A Gestão Técnica e o administrador cadastram os registros.
        </p>
      ) : null}

      <Modal
        open={Boolean(selected)}
        title={listTitle(detailTable, selected) || CONFIG[detailTable]?.title || cfg.title}
        onClose={closeDetail}
        className="modal-sheet--catalog"
      >
        <CatalogDetailView
          fields={detailFields}
          relatedGroups={relatedGroups}
          onOpenRelated={openRelated}
          logoUrl={selected?.logoUrl}
          iconName={detailTable === 'locais' ? iconForLocal(selected?.nome, selected?.descricao) : ''}
        />
      </Modal>
    </Page>
  );
}

export function CatalogDetail({ table }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const cfg = CONFIG[table];
  const [row, setRow] = useState(null);
  const [relatedGroups, setRelatedGroups] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadCatalogRow(table, id);
        if (cancelled) return;
        setRow(data);
        setRelatedGroups(await loadRelatedGroups(table, id));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Não foi possível abrir o registro.');
      }
    })();
    return () => { cancelled = true; };
  }, [id, table]);

  return (
    <Page title={cfg.title}>
      <Alert error={error} />
      <Modal
        open={Boolean(row)}
        title={listTitle(table, row) || cfg.title}
        onClose={() => navigate(cfg.path)}
        className="modal-sheet--catalog"
      >
        <CatalogDetailView
          fields={detailFieldsFor(table, row)}
          relatedGroups={relatedGroups}
          onOpenRelated={(item) => item?.to && navigate(item.to)}
          logoUrl={row?.logoUrl}
          iconName={table === 'locais' ? iconForLocal(row?.nome, row?.descricao) : ''}
        />
      </Modal>
    </Page>
  );
}
