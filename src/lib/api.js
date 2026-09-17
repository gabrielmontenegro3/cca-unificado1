import { supabase } from './supabase';
import { embedOne, fileKind, formatDbError, formatTelefone, labelUnidade, normalizarCnpj } from './format.js';
import { buildCondoSeed, validarCriacaoCondominio, nomeEmpresaKey } from './parseSeed.js';
import { areaForLocal, tipoForLocal } from './localIcon.js';
import { normalizarDominio } from './branding.js';
import {
  TIPO_INSPECAO_AGENDADA,
  eventoEhInspecaoAgendada,
  isoAgendamento,
  mensagemChatVisita,
  previewTextoChat,
  proximaVisitaAgendada,
  tituloInspecaoAgendada,
  visitaAgendadaDeMensagens,
} from './chamadoRastreabilidade.js';

const CAPA_MAX_BYTES = 20 * 1024 * 1024;
const CAPA_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

async function compactarImagem(file, { maxWidth, quality }) {
  if (!file?.type?.startsWith('image/') || file.type === 'image/svg+xml') return file;
  // PNG/WebP com transparência: não converter para JPEG
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / Math.max(bitmap.width, 1));
    if (scale === 1 && file.size < 700_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d', { alpha: keepAlpha });
    if (keepAlpha) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const mime = keepAlpha ? file.type : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, keepAlpha ? undefined : quality));
    if (!blob || blob.size >= file.size) return file;
    const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
    return new File([blob], file.name.replace(/\.[^.]+$/, ext), { type: mime });
  } catch {
    return file;
  }
}

export async function uploadArquivo({ condominioId, userId, file, folder, fileName, quality }) {
  if (!file) throw new Error('Selecione um arquivo.');
  const originalQuality = quality === 'original'
    || (folder === 'marca' && /^(capa|logo)\./i.test(String(fileName || '')));

  if (originalQuality) {
    if (!CAPA_TYPES.has(String(file.type || '').toLowerCase()) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      throw new Error('Use JPG, PNG ou WebP.');
    }
    if (file.size > CAPA_MAX_BYTES) {
      throw new Error('A imagem pode ter até 20 MB para manter a qualidade.');
    }
  } else if (file.type?.startsWith('image/') && file.type !== 'image/svg+xml') {
    const compacted = await compactarImagem(file, { maxWidth: 1600, quality: 0.72 });
    if (compacted !== file && fileName) {
      const ext = compacted.type === 'image/png' ? '.png' : compacted.type === 'image/webp' ? '.webp' : '.jpg';
      fileName = String(fileName).replace(/\.[^.]+$/, ext);
    }
    file = compacted;
  }

  const original = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const safeName = fileName || `${crypto.randomUUID()}-${original}`;
  const path = `${condominioId}/${folder}/${safeName}`;
  const { error: upErr } = await supabase.storage.from('condominios').upload(path, file, {
    upsert: Boolean(fileName),
    contentType: file.type || undefined,
  });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from('arquivos')
    .insert({
      condominio_id: condominioId,
      nome_original: file.name,
      nome_arquivo: safeName,
      storage_path: path,
      bucket: 'condominios',
      mime_type: file.type || null,
      tamanho_bytes: file.size,
      tipo: fileKind(file.type),
      enviado_por: userId,
    })
    .select('id, storage_path, nome_original, tipo, mime_type')
    .single();
  if (error) throw error;
  return data;
}

export function publicOrSignedUrl(path) {
  return supabase.storage.from('condominios').createSignedUrl(path, 60 * 60);
}

function isMissingColumnError(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || error?.details || '');
  return code === 'PGRST204'
    || /schema cache/i.test(msg)
    || /could not find the '[^']+' column/i.test(msg)
    || /column .+ does not exist/i.test(msg);
}

async function insertRows(table, rows, optionalKeys = []) {
  if (!rows?.length) return;
  const { error } = await supabase.from(table).insert(rows);
  if (!error) return;
  const msg = String(error.message || error.details || '');
  // Coluna ainda não existe — tenta de novo sem os campos opcionais
  if (optionalKeys.length && isMissingColumnError(error)) {
    const stripped = rows.map((row) => {
      const next = { ...row };
      for (const key of optionalKeys) delete next[key];
      return next;
    });
    return insertRows(table, stripped);
  }
  // Coluna/tabela ainda não existe no schema — ignora partes opcionais do seed
  if (isMissingColumnError(error) || /could not find the table/i.test(msg)) return;
  // Duplicata em listas/vínculos — segue
  if (error.code === '23505' || /duplicate key|unique constraint/i.test(msg)) return;
  throw new Error(formatDbError(error, table));
}

async function upsertJoinRows(table, rows, conflict) {
  if (!rows?.length) return;
  const { error } = await supabase.from(table).upsert(rows, {
    onConflict: conflict,
    ignoreDuplicates: true,
  });
  if (!error) return;
  const msg = String(error.message || error.details || '');
  if (/no unique|ON CONFLICT|schema cache|could not find|does not exist|column/i.test(msg)) {
    return insertRows(table, rows);
  }
  if (error.code === '23505' || /duplicate key|unique constraint/i.test(msg)) return;
  throw new Error(formatDbError(error, table));
}

function nomeKey(value) {
  return nomeEmpresaKey(value);
}

async function mapNomes(table, condoId) {
  const { data, error } = await supabase.from(table).select('id, nome').eq('condominio_id', condoId);
  if (error) throw new Error(formatDbError(error, table));
  const map = new Map();
  for (const row of data || []) {
    const key = nomeKey(row.nome);
    if (key && !map.has(key)) map.set(key, row.id);
  }
  return map;
}

async function insertNamedRows(table, rows, optionalKeys = []) {
  if (!rows?.length) return [];
  const { data, error } = await supabase.from(table).insert(rows).select('id, nome');
  if (!error) return data || [];
  const msg = String(error.message || error.details || '');
  if (optionalKeys.length && isMissingColumnError(error)) {
    const stripped = rows.map((row) => {
      const next = { ...row };
      for (const key of optionalKeys) delete next[key];
      return next;
    });
    return insertNamedRows(table, stripped);
  }
  if (isMissingColumnError(error) || /could not find the table/i.test(msg)) return [];
  if (error.code === '23505' || /duplicate key|unique constraint/i.test(msg)) return [];
  throw new Error(formatDbError(error, table));
}

async function ensureNomes(table, condoId, names, extra, optionalKeys = []) {
  const map = await mapNomes(table, condoId);
  const missing = [];
  const seen = new Set();
  for (const name of names) {
    const key = nomeKey(name);
    if (!key || map.has(key) || seen.has(key)) continue;
    seen.add(key);
    missing.push({
      condominio_id: condoId,
      nome: String(name).trim(),
      ...(typeof extra === 'function' ? extra(name) : extra || {}),
    });
  }
  if (!missing.length) return map;
  const inserted = await insertNamedRows(table, missing, optionalKeys);
  for (const row of inserted) {
    const key = nomeKey(row.nome);
    if (key) map.set(key, row.id);
  }
  if (inserted.length < missing.length) {
    const again = await mapNomes(table, condoId);
    for (const [key, id] of again) map.set(key, id);
  }
  return map;
}

async function mapPool(items, limit, fn) {
  const list = items || [];
  if (!list.length) return [];
  const out = new Array(list.length);
  let index = 0;
  async function worker() {
    while (index < list.length) {
      const current = index;
      index += 1;
      out[current] = await fn(list[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return out;
}

async function popularCondominioCliente(condoId, seed, userId, fornecedorLogos) {
  await Promise.all([
    seed.visao_geral
      ? insertRows('visao_geral_secoes', [{ condominio_id: condoId, titulo: 'Visão geral', texto: seed.visao_geral, ordem: 0 }])
      : null,
    seed.sobre_empreendimento
      ? insertRows('empreendimento_secoes', [{ condominio_id: condoId, titulo: 'Sobre o empreendimento', texto: seed.sobre_empreendimento, ordem: 0 }])
      : null,
    seed.sobre_nos
      ? insertRows('sobre_nos', [{ condominio_id: condoId, titulo: 'Sobre nós', texto: seed.sobre_nos, ordem: 0 }])
      : null,
    seed.assistencia_tecnica
      ? insertRows('visao_geral_secoes', [{ condominio_id: condoId, titulo: 'Assistência técnica', texto: seed.assistencia_tecnica, ordem: 1 }])
      : null,
    seed.boletim_titulo && seed.boletim_texto
      ? insertRows('boletins_informativos', [{
        condominio_id: condoId,
        autor_id: userId,
        titulo: seed.boletim_titulo,
        texto: seed.boletim_texto,
        publicado: true,
        data_publicacao: new Date().toISOString(),
      }])
      : null,
    seed.email
      ? insertRows('contatos', [{ condominio_id: condoId, nome: 'Condomínio', email: seed.email, ordem: 0, ativo: true }])
      : null,
  ]);

  await Promise.all([
    insertRows('fornecedores', seed.fornecedores.map((row) => ({
      condominio_id: condoId,
      nome: row.nome_fantasia || row.nome,
      razao_social: row.razao_social || null,
      nome_fantasia: row.nome_fantasia || row.nome || null,
      cnpj: normalizarCnpj(row.cnpj),
      contato: row.contato || null,
      telefone: formatTelefone(row.telefone) || null,
      telefone1: formatTelefone(row.telefone1) || null,
      telefone2: formatTelefone(row.telefone2) || null,
      localizacao: row.localizacao || null,
    })), ['telefone1', 'telefone2', 'localizacao', 'contato', 'logo_path', 'razao_social', 'nome_fantasia']),
    insertRows('materiais', seed.materiais.map((row) => ({
      condominio_id: condoId,
      nome: row.nome,
    }))),
    insertRows('locais', seed.locais.map((row) => ({
      condominio_id: condoId,
      nome: row.nome,
      tipo: tipoForLocal(row.nome, row.descricao),
      area: areaForLocal(row.nome, row.descricao, row.area),
      descricao: row.descricao || null,
    })), ['area']),
    insertRows('garantias', seed.garantias.map((row) => {
      const unidade = String(row.prazo_unidade || '').trim().toLowerCase();
      const prazoUnidade = ['dias', 'meses', 'anos'].includes(unidade) ? unidade : (unidade || null);
      const prazoValor = row.prazo_valor !== '' && row.prazo_valor != null
        ? Number(String(row.prazo_valor).replace(/\D/g, '')) || null
        : null;
      return {
        condominio_id: condoId,
        nome: row.nome,
        prazo_valor: prazoValor,
        prazo_unidade: prazoUnidade,
        data_fim: row.data_fim || null,
        motivos_perda_garantia: row.motivos_perda_garantia || null,
        descricao: row.descricao || null,
        telefone: formatTelefone(row.telefone) || null,
      };
    }), ['telefone', 'prazo_valor', 'prazo_unidade', 'data_fim', 'motivos_perda_garantia']),
    insertRows('unidades', [
      ...((seed.unidades || []).some((row) => {
        const n = String(row.identificacao || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();
        return n === 'areas comuns';
      }) ? [] : [{ condominio_id: condoId, identificacao: 'Áreas comuns' }]),
      ...(seed.unidades || []).map((row) => ({
        condominio_id: condoId,
        identificacao: row.identificacao,
        bloco: row.bloco || null,
        andar: row.andar || null,
      })),
    ]),
    insertRows('contatos', seed.contatos.map((row, index) => ({
      condominio_id: condoId,
      nome: row.nome,
      telefone: formatTelefone(row.telefone) || null,
      email: row.email || null,
      subtitulo: row.subtitulo || null,
      ordem: index + 1,
      ativo: true,
    }))),
  ]);

  const linhas = seed.linhas_base || [];
  if (linhas.length) {
    const fornByMat = new Map();
    for (const linha of linhas) {
      const mat = nomeKey(linha.material);
      const forn = nomeKey(linha.fornecedor);
      if (mat && forn && !fornByMat.has(mat)) fornByMat.set(mat, forn);
    }

    const [fornMap, locMap, garMap] = await Promise.all([
      ensureNomes('fornecedores', condoId, linhas.map((linha) => linha.fornecedor)),
      ensureNomes('locais', condoId, linhas.map((linha) => linha.local), (name) => ({
        tipo: tipoForLocal(name),
        area: areaForLocal(name),
      }), ['area']),
      ensureNomes('garantias', condoId, linhas.map((linha) => linha.garantia)),
    ]);
    const matMap = await ensureNomes(
      'materiais',
      condoId,
      linhas.map((linha) => linha.material),
      (name) => ({ fornecedor_id: fornMap.get(fornByMat.get(nomeKey(name))) || null }),
      ['fornecedor_id'],
    );

    const joinsML = [];
    const joinsMG = [];
    const joinsFG = [];
    const seenML = new Set();
    const seenMG = new Set();
    const seenFG = new Set();
    for (const linha of linhas) {
      const fornecedorId = fornMap.get(nomeKey(linha.fornecedor));
      const materialId = matMap.get(nomeKey(linha.material));
      const localId = locMap.get(nomeKey(linha.local));
      const garantiaId = garMap.get(nomeKey(linha.garantia));
      if (materialId && localId) {
        const key = `${materialId}:${localId}`;
        if (!seenML.has(key)) {
          seenML.add(key);
          joinsML.push({ material_id: materialId, local_id: localId });
        }
      }
      if (materialId && garantiaId) {
        const key = `${materialId}:${garantiaId}`;
        if (!seenMG.has(key)) {
          seenMG.add(key);
          joinsMG.push({ material_id: materialId, garantia_id: garantiaId });
        }
      }
      if (fornecedorId && garantiaId) {
        const key = `${fornecedorId}:${garantiaId}`;
        if (!seenFG.has(key)) {
          seenFG.add(key);
          joinsFG.push({ fornecedor_id: fornecedorId, garantia_id: garantiaId });
        }
      }
    }

    await Promise.all([
      upsertJoinRows('material_locais', joinsML, 'material_id,local_id'),
      upsertJoinRows('material_garantias', joinsMG, 'material_id,garantia_id'),
      upsertJoinRows('fornecedor_garantias', joinsFG, 'fornecedor_id,garantia_id'),
    ]).catch(() => { /* vínculo complementar */ });
  }

  const usuarios = (seed.usuarios || []).filter((user) => user.email);
  if (usuarios.length) {
    const emails = [...new Set(usuarios.map((user) => String(user.email).trim()))];
    const [{ data: profiles, error: profilesErr }, { data: cargos, error: cargosErr }] = await Promise.all([
      supabase.from('usuarios').select('id, email').in('email', emails),
      supabase.from('cargos').select('id, tipo'),
    ]);
    if (profilesErr) throw new Error(formatDbError(profilesErr, 'usuarios'));
    if (cargosErr) throw new Error(formatDbError(cargosErr, 'cargos'));
    const profileByEmail = new Map(
      (profiles || []).map((row) => [String(row.email || '').trim().toLowerCase(), row.id]),
    );
    const cargoByTipo = new Map((cargos || []).map((row) => [row.tipo, row.id]));
    await insertRows('usuario_condominio', usuarios.flatMap((user) => {
      const usuarioId = profileByEmail.get(String(user.email).trim().toLowerCase());
      if (!usuarioId) return [];
      const cargoTipo = String(user.cargo || 'morador').toLowerCase().replace(/\s+/g, '_');
      return [{
        usuario_id: usuarioId,
        condominio_id: condoId,
        cargo_id: cargoByTipo.get(cargoTipo) || cargoByTipo.get('morador') || null,
        ativo: true,
      }];
    }));
  }

  await aplicarLogosFornecedores(condoId, userId, fornecedorLogos);
}

async function aplicarLogosFornecedores(condoId, userId, logos) {
  if (!condoId || !logos) return;
  const entries = Object.entries(logos).filter(([, value]) => {
    const file = value?.file || value;
    return file instanceof File;
  });
  if (!entries.length) return;
  const map = await mapNomes('fornecedores', condoId);
  await mapPool(entries, 3, async ([key, value]) => {
    const file = value?.file || value;
    const id = map.get(key);
    if (!id || !file) return null;
    try {
      const arquivo = await uploadArquivo({
        condominioId: condoId,
        userId,
        file,
        folder: 'fornecedores',
        quality: 'original',
      });
      const { error } = await supabase
        .from('fornecedores')
        .update({ logo_path: arquivo.storage_path })
        .eq('id', id);
      if (error && /logo_path|schema cache|does not exist|column/i.test(error.message || '')) return null;
      if (error) throw error;
    } catch {
      return null;
    }
    return id;
  });
}

export async function salvarLogoFornecedor({ condominioId, userId, fornecedorId, file }) {
  if (!file || !fornecedorId) return null;
  const arquivo = await uploadArquivo({
    condominioId,
    userId,
    file,
    folder: 'fornecedores',
    quality: 'original',
  });
  const { error } = await supabase
    .from('fornecedores')
    .update({ logo_path: arquivo.storage_path })
    .eq('id', fornecedorId);
  if (error) throw new Error(formatDbError(error, 'fornecedores'));
  return arquivo.storage_path;
}

/** Valida no cliente; só então cria o condomínio com a RPC já existente. */
export async function criarCondominio(form, userId) {
  const validation = validarCriacaoCondominio(form);
  if (validation.length) throw new Error(validation[0]);

  const seed = buildCondoSeed(form);
  let condoId = null;

  try {
    const { data, error } = await supabase.rpc('criar_condominio', {
      p_nome: form.nome,
      p_cnpj: normalizarCnpj(form.cnpj),
      p_descricao: form.descricao || null,
      p_cep: form.cep || null,
      p_logradouro: form.logradouro || null,
      p_numero: form.numero || null,
      p_complemento: form.complemento || null,
      p_bairro: form.bairro || null,
      p_cidade: form.cidade || null,
      p_estado: form.estado || null,
    });
    if (error) throw new Error(formatDbError(error, 'criar_condominio'));
    condoId = data;
    if (!condoId) throw new Error('Não foi possível criar o condomínio.');

    if (form.construtora_id) {
      const rpc = await supabase.rpc('vincular_condominio_a_construtora', {
        p_condominio_id: condoId,
        p_construtora_id: form.construtora_id,
      });
      if (rpc.error) {
        const link = await supabase
          .from('condominios')
          .update({ construtora_id: form.construtora_id })
          .eq('id', condoId);
        if (link.error) {
          throw new Error('Não foi possível vincular o condomínio à construtora. Rode o SQL condo-construtora-vinculo.sql no Supabase.');
        }
      }
    }

    await popularCondominioCliente(condoId, seed, userId, form.fornecedorLogos);

    async function saveNamedImage(file, folder, titulo, tipo) {
      if (!file) return null;
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const arquivo = await uploadArquivo({
        condominioId: condoId,
        userId,
        file,
        folder,
        fileName: tipo ? `${tipo}.${ext}` : undefined,
        quality: tipo === 'capa' || tipo === 'logo' ? 'original' : 'compact',
      });
      const row = {
        condominio_id: condoId,
        arquivo_id: arquivo.id,
        titulo,
        ordem: 0,
      };
      if (tipo) {
        const first = await supabase.from('imagens_condominio').insert({ ...row, tipo });
        if (first.error) await insertRows('imagens_condominio', [row]);
      } else {
        await insertRows('imagens_condominio', [row]);
      }
      return arquivo;
    }

    const [logo] = await Promise.all([
      saveNamedImage(form.logo, 'marca', 'Logo', 'logo'),
      saveNamedImage(form.imagem_visao_geral, 'marca', 'Imagem visão geral', 'visao_geral'),
      saveNamedImage(form.imagem_capa, 'marca', 'Imagem capa', 'capa'),
      saveNamedImage(form.imagem_login, 'marca', 'Imagem login', 'login'),
    ]);
    if (logo?.storage_path) {
      await supabase.from('condominios').update({ logo_path: logo.storage_path }).eq('id', condoId);
    }

    await mapPool(form.imagens || [], 4, (file) => saveNamedImage(file, 'imagens', file.name));
    await mapPool(form.documentos || [], 3, async (file) => {
      try {
        const arquivo = await uploadArquivo({ condominioId: condoId, userId, file, folder: 'documentos' });
        await insertRows('documentos_empreendimento', [{
          condominio_id: condoId,
          arquivo_id: arquivo.id,
          titulo: file.name,
        }]);
      } catch {
        /* documento opcional — não aborta a criação do condomínio */
      }
    });

    return condoId;
  } catch (err) {
    if (condoId) {
      try {
        await supabase.rpc('desfazer_criar_condominio', { p_condominio_id: condoId });
      } catch {
        try {
          await supabase.from('condominios').delete().eq('id', condoId);
        } catch { /* best effort */ }
      }
      throw new Error(`${formatDbError(err)} A criação foi cancelada e o registro parcial foi removido.`);
    }
    throw new Error(formatDbError(err));
  }
}
export async function salvarDominioCondominio(condoId, dominio) {
  if (!condoId) throw new Error('Condomínio inválido.');
  const rpc = await supabase.rpc('salvar_dominio_condominio', {
    p_condominio_id: condoId,
    p_dominio: dominio || null,
  });
  if (!rpc.error) return rpc.data || '';
  const value = normalizarDominio(dominio) || null;
  const { error } = await supabase.from('condominios').update({ dominio: value }).eq('id', condoId);
  if (error) throw error;
  return value || '';
}

export async function listarConstrutoras() {
  const { data, error } = await supabase
    .from('construtoras')
    .select('*')
    .order('nome');
  if (error) throw new Error(formatDbError(error, 'construtoras'));
  return data || [];
}

export async function criarConstrutora(form) {
  const razaoSocial = String(form?.razao_social || '').trim();
  const nomeFantasia = String(form?.nome_fantasia || form?.nome || '').trim();
  if (razaoSocial.length < 2) throw new Error('Informe a razão social da construtora.');
  if (nomeFantasia.length < 2) throw new Error('Informe o nome fantasia da construtora.');
  if (!form?.logo) throw new Error('Envie a logomarca da construtora.');

  const payload = {
    nome: nomeFantasia,
    razao_social: razaoSocial,
    nome_fantasia: nomeFantasia,
    cnpj: normalizarCnpj(form?.cnpj) || null,
    email: String(form?.email || '').trim() || null,
    descricao: String(form?.descricao || '').trim() || null,
    ativo: true,
  };
  const { data, error } = await supabase.from('construtoras').insert(payload).select('id').single();
  if (error) {
    throw new Error(
      /schema cache|could not find the table|construtoras|razao_social|nome_fantasia/i.test(error.message || '')
        ? 'Rode o SQL construtoras.sql no Supabase para atualizar a tabela de construtoras.'
        : formatDbError(error, 'construtoras'),
    );
  }
  const id = data?.id;
  if (!id) throw new Error('Não foi possível criar a construtora.');

  if (form?.logo) {
    const ext = (form.logo.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${id}/marca/logo.${ext}`;
    const up = await supabase.storage.from('condominios').upload(path, form.logo, {
      upsert: true,
      contentType: form.logo.type || undefined,
    });
    if (!up.error) {
      await supabase.from('construtoras').update({ logo_path: path }).eq('id', id);
    }
  }
  return id;
}

export async function salvarDominioConstrutora(id, dominio) {
  if (!id) throw new Error('Construtora inválida.');
  const rpc = await supabase.rpc('salvar_dominio_construtora', {
    p_construtora_id: id,
    p_dominio: dominio || null,
  });
  if (!rpc.error) return rpc.data || '';
  const value = normalizarDominio(dominio) || null;
  const { error } = await supabase.from('construtoras').update({ dominio: value }).eq('id', id);
  if (error) throw error;
  return value || '';
}

export async function criarUsuarioConstrutora({ construtoraId, email, password, nome, escopoCondominioIds }) {
  if (!construtoraId) throw new Error('Construtora inválida.');
  const payload = {
    p_construtora_id: construtoraId,
    p_email: String(email || '').trim().toLowerCase(),
    p_senha: password,
    p_nome: nome || null,
    p_escopo_condominio_ids: escopoCondominioIds?.length ? escopoCondominioIds : null,
  };
  let { data, error } = await supabase.rpc('criar_usuario_construtora', payload);
  if (error && /p_escopo|could not find/i.test(error.message || '')) {
    const fallback = await supabase.rpc('criar_usuario_construtora', {
      p_construtora_id: construtoraId,
      p_email: payload.p_email,
      p_senha: password,
      p_nome: nome || null,
    });
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  return data;
}

export async function listarUsuariosConstrutora(construtoraId) {
  if (!construtoraId) return [];
  const { data, error } = await supabase.rpc('listar_usuarios_construtora', {
    p_construtora_id: construtoraId,
  });
  if (error) throw error;
  return data || [];
}

export async function urlFotoUsuario(path) {
  if (!path || !supabase) return '';
  const signed = await supabase.storage.from('condominios').createSignedUrl(path, 60 * 60 * 24 * 7);
  return signed.data?.signedUrl || '';
}

export async function salvarFotoUsuario(userId, file) {
  if (!userId) throw new Error('Usuário inválido.');
  if (!file) throw new Error('Selecione uma foto.');
  if (!file.type?.startsWith('image/')) throw new Error('A foto precisa ser uma imagem.');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${userId}/perfil/foto.${ext}`;
  const up = await supabase.storage.from('condominios').upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (up.error) throw up.error;
  const rpc = await supabase.rpc('salvar_foto_usuario', {
    p_usuario_id: userId,
    p_foto_path: path,
  });
  if (rpc.error) {
    const { error } = await supabase.from('usuarios').update({ foto_path: path }).eq('id', userId);
    if (error) throw rpc.error;
  }
  return path;
}

export async function criarConviteConstrutora({ construtoraId, email, escopoCondominioIds }) {
  if (!construtoraId) throw new Error('Construtora inválida.');
  const { data, error } = await supabase.rpc('criar_convite_construtora', {
    p_construtora_id: construtoraId,
    p_email: email || null,
    p_escopo_condominio_ids: escopoCondominioIds?.length ? escopoCondominioIds : null,
  });
  if (error) throw error;
  return data;
}

export async function listarConvitesConstrutora(construtoraId) {
  if (!construtoraId) return [];
  const { data, error } = await supabase.rpc('listar_convites_construtora', {
    p_construtora_id: construtoraId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function criarConviteGestaoTecnica(email) {
  const { data, error } = await supabase.rpc('criar_convite_gestao_tecnica', {
    p_email: email || null,
  });
  if (error) throw error;
  return data;
}

export async function listarConvitesGestaoTecnica() {
  const { data, error } = await supabase.rpc('listar_convites_gestao_tecnica');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function listarCondominiosDaConstrutora(construtoraId) {
  if (!construtoraId) return [];
  const { data, error } = await supabase
    .from('condominios')
    .select('id, nome')
    .eq('construtora_id', construtoraId)
    .order('nome');
  if (error) throw error;
  return data || [];
}

export async function salvarEscopoUsuarioConstrutora({ usuarioId, construtoraId, escopoCondominioIds }) {
  if (!usuarioId) throw new Error('Usuário inválido.');
  if (!construtoraId) throw new Error('Construtora inválida.');
  const { error } = await supabase.rpc('aplicar_escopo_construtora', {
    p_usuario_id: usuarioId,
    p_construtora_id: construtoraId,
    p_ids: escopoCondominioIds?.length ? escopoCondominioIds : null,
  });
  if (error) throw error;
}

export async function criarChamado({ condominioId, userId, titulo, descricao, files }) {
  const { data, error } = await supabase.rpc('abrir_chamado', {
    p_condominio_id: condominioId,
    p_titulo: titulo,
    p_descricao: descricao || null,
  });
  if (error) throw error;
  const chamado = typeof data === 'string' ? JSON.parse(data) : data;
  if (!chamado?.id) throw new Error('Não foi possível abrir o chamado.');

  const uploaded = [];
  for (const file of files || []) {
    const arquivo = await uploadArquivo({
      condominioId,
      userId,
      file,
      folder: `chamados/${chamado.id}`,
    });
    await supabase.from('chamado_arquivos').insert({ chamado_id: chamado.id, arquivo_id: arquivo.id });
    uploaded.push(arquivo);
  }

  if (uploaded.length) {
    try {
      const convId = await garantirChatChamado(chamado.id, userId);
      const { data: msg } = await supabase.from('mensagens').insert({
        conversa_id: convId,
        usuario_id: userId,
        texto: 'Imagem',
      }).select('id').single();
      if (msg?.id) {
        await supabase.from('mensagem_arquivos').insert(
          uploaded.map((arquivo) => ({ mensagem_id: msg.id, arquivo_id: arquivo.id })),
        );
      }
    } catch {
      /* a foto continua em chamado_arquivos e entra no chat na leitura */
    }
  }

  return chamado;
}

export async function minhaUnidade(condominioId) {
  const { data, error } = await supabase.rpc('minha_unidade', { p_condominio_id: condominioId });
  if (error) throw error;
  return data || null;
}

function rpcAusente(error) {
  const code = error?.code || '';
  const msg = String(error?.message || '');
  return code === 'PGRST202' || /schema cache|could not find the function/i.test(msg);
}

function rpcEstruturaIncompativel(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  return code === '42804' || /structure of query does not match/i.test(msg);
}

function ignoraDuplicado(error) {
  if (!error) return true;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return code === '23505' || /duplicate|unique|already exists|conflict/i.test(msg);
}

async function garantirChatDireto(chamadoId, userId) {
  const { data: chamado, error: chErr } = await supabase
    .from('chamados')
    .select('id, condominio_id, titulo')
    .eq('id', chamadoId)
    .single();
  if (chErr) throw chErr;

  let { data: conv, error: convErr } = await supabase
    .from('conversas')
    .select('id')
    .eq('chamado_id', chamadoId)
    .maybeSingle();
  if (convErr) throw convErr;

  if (!conv?.id) {
    const created = await supabase
      .from('conversas')
      .insert({
        condominio_id: chamado.condominio_id,
        tipo: 'chamado',
        titulo: chamado.titulo,
        chamado_id: chamadoId,
      })
      .select('id')
      .single();
    if (created.error) {
      const again = await supabase.from('conversas').select('id').eq('chamado_id', chamadoId).maybeSingle();
      if (!again.data?.id) throw created.error;
      conv = again.data;
    } else {
      conv = created.data;
    }
  }

  const part = await supabase.from('conversa_participantes').insert({
    conversa_id: conv.id,
    usuario_id: userId,
  });
  if (part.error && !ignoraDuplicado(part.error)) {
    const update = await supabase
      .from('conversa_participantes')
      .update({ saiu_em: null })
      .eq('conversa_id', conv.id)
      .eq('usuario_id', userId);
    if (update.error && !ignoraDuplicado(update.error)) {
      /* segue: pode já estar na conversa */
    }
  }

  return conv.id;
}

export async function garantirChatChamado(chamadoId, userId) {
  const { data, error } = await supabase.rpc('garantir_chat_chamado', { p_chamado_id: chamadoId });
  if (!error && data) return data;
  if (error && !rpcAusente(error)) throw error;
  return garantirChatDireto(chamadoId, userId);
}

export async function avaliarChamado(chamadoId, estrelas) {
  const nota = Number(estrelas);
  if (!chamadoId || nota < 1 || nota > 5) {
    throw new Error('Escolha de 1 a 5 estrelas.');
  }
  const { data, error } = await supabase.rpc('avaliar_chamado', {
    p_chamado_id: chamadoId,
    p_estrelas: nota,
  });
  if (error) {
    if (rpcAusente(error)) {
      throw new Error('Rode o SQL chamado-satisfacao.sql no Supabase para ativar a avaliação.');
    }
    throw new Error(formatDbError(error, 'avaliação'));
  }
  return data;
}

export async function enviarMensagemChamado(chamadoId, texto, userId) {
  const trimmed = String(texto || '').trim();
  if (!trimmed) throw new Error('Escreva a mensagem');

  const rpc = await supabase.rpc('enviar_mensagem_chamado', {
    p_chamado_id: chamadoId,
    p_texto: trimmed,
  });
  if (!rpc.error) return rpc.data;

  if (!rpcAusente(rpc.error) && rpc.error.code !== '42501') {
    throw rpc.error;
  }

  const convId = await garantirChatChamado(chamadoId, userId);
  const { data, error } = await supabase
    .from('mensagens')
    .insert({
      conversa_id: convId,
      usuario_id: userId,
      texto: trimmed,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function mapaUltimasMensagensChamados(chamadoIds) {
  const ids = [...new Set((chamadoIds || []).filter(Boolean))];
  const map = {};
  if (!ids.length) return map;

  const convs = [];
  for (let i = 0; i < ids.length; i += 80) {
    const { data } = await supabase
      .from('conversas')
      .select('id, chamado_id')
      .in('chamado_id', ids.slice(i, i + 80));
    convs.push(...(data || []));
  }
  const convToChamado = Object.fromEntries(convs.map((row) => [row.id, row.chamado_id]));
  const convIds = convs.map((row) => row.id);
  if (!convIds.length) return map;

  const msgs = [];
  for (let i = 0; i < convIds.length; i += 80) {
    const { data } = await supabase
      .from('mensagens')
      .select('conversa_id, texto, created_at, excluido_em')
      .in('conversa_id', convIds.slice(i, i + 80))
      .order('created_at', { ascending: false });
    msgs.push(...(data || []));
  }

  for (const m of msgs) {
    if (m.excluido_em) continue;
    const chamadoId = convToChamado[m.conversa_id];
    if (!chamadoId || map[chamadoId]) continue;
    const preview = previewTextoChat(m.texto);
    if (!preview) continue;
    map[chamadoId] = preview;
  }
  return map;
}

export async function carregarEventosChatChamado(chamadoId) {
  if (!chamadoId) return { historico: [], visitas: [] };
  const [hist, visitas] = await Promise.all([
    supabase
      .from('chamado_status_historico')
      .select('id, status_anterior, status_novo, created_at')
      .eq('chamado_id', chamadoId)
      .order('created_at'),
    listarAgendamentosVisitaChamado(chamadoId),
  ]);
  return { historico: hist.data || [], visitas: visitas || [] };
}

export function arquivoEhImagem(arquivo) {
  const tipo = String(arquivo?.tipo || '').toLowerCase();
  const mime = String(arquivo?.mime_type || '').toLowerCase();
  const nome = String(arquivo?.nome_original || arquivo?.nome_arquivo || arquivo?.storage_path || '').toLowerCase();
  return tipo === 'imagem' || mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(nome);
}

export function nomeArquivoDaMensagem(texto) {
  const raw = String(texto || '').trim();
  const match = raw.match(/^arquivo:\s*(.+)$/i);
  return (match?.[1] || '').trim();
}

export async function resolverUrlArquivo(arquivo) {
  if (!arquivo?.storage_path) return { ...arquivo, url: null, isImage: arquivoEhImagem(arquivo) };
  const signed = await supabase.storage.from('condominios').createSignedUrl(arquivo.storage_path, 60 * 60);
  return {
    ...arquivo,
    url: signed.data?.signedUrl || null,
    isImage: arquivoEhImagem(arquivo),
  };
}

async function arquivosPorIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await supabase
    .from('arquivos')
    .select('id, storage_path, nome_original, nome_arquivo, tipo, mime_type')
    .in('id', unique);
  return Object.fromEntries((data || []).map((file) => [file.id, file]));
}

async function arquivoPorNome(nome) {
  if (!nome) return null;
  const byOriginal = await supabase
    .from('arquivos')
    .select('id, storage_path, nome_original, nome_arquivo, tipo, mime_type, created_at')
    .eq('nome_original', nome)
    .order('created_at', { ascending: false })
    .limit(1);
  if (byOriginal.data?.[0]) return byOriginal.data[0];
  const byStored = await supabase
    .from('arquivos')
    .select('id, storage_path, nome_original, nome_arquivo, tipo, mime_type, created_at')
    .eq('nome_arquivo', nome)
    .order('created_at', { ascending: false })
    .limit(1);
  return byStored.data?.[0] || null;
}

export async function anexarArquivosNasMensagens(mensagens) {
  const list = mensagens || [];
  const ids = list.map((m) => m.id).filter(Boolean);
  if (!ids.length) return list;

  const links = await supabase
    .from('mensagem_arquivos')
    .select('mensagem_id, arquivo_id')
    .in('mensagem_id', ids);
  const byId = await arquivosPorIds((links.data || []).map((row) => row.arquivo_id));

  const grouped = {};
  for (const row of links.data || []) {
    const file = byId[row.arquivo_id];
    if (!file) continue;
    (grouped[row.mensagem_id] ||= []).push(file);
  }

  await Promise.all(list.map(async (m) => {
    if (grouped[m.id]?.length) return;
    const nome = nomeArquivoDaMensagem(m.texto);
    if (!nome) return;
    const found = await arquivoPorNome(nome);
    if (found) grouped[m.id] = [found];
  }));

  return Promise.all(list.map(async (m) => ({
    ...m,
    anexos: await Promise.all((grouped[m.id] || []).map(resolverUrlArquivo)),
  })));
}

export async function enviarArquivoChamado({ chamadoId, condominioId, userId, file, caption }) {
  const convId = await garantirChatChamado(chamadoId, userId);
  const label = caption?.trim() || `Arquivo: ${file.name}`;
  const { data: msg, error: msgErr } = await supabase.from('mensagens').insert({
    conversa_id: convId,
    usuario_id: userId,
    texto: label,
  }).select('id').single();
  if (msgErr) throw msgErr;
  const arquivo = await uploadArquivo({
    condominioId,
    userId,
    file,
    folder: `mensagens/${msg.id}`,
  });
  await supabase.from('mensagem_arquivos').insert({
    mensagem_id: msg.id,
    arquivo_id: arquivo.id,
  });
  return { ...msg, anexos: [await resolverUrlArquivo(arquivo)] };
}

export async function criarLaudo({ condominioId, userId, chamadoId, titulo, descricao, files, criticidade }) {
  if (!chamadoId) throw new Error('Selecione o chamado relacionado a este laudo.');

  const { data: chamado, error: chErr } = await supabase
    .from('chamados')
    .select('id, condominio_id, titulo, numero_registro, unidades(identificacao, bloco, andar)')
    .eq('id', chamadoId)
    .single();
  if (chErr) throw chErr;
  if (chamado.condominio_id !== condominioId) {
    throw new Error('O chamado precisa ser deste condomínio.');
  }

  const unidade = labelUnidade(chamado.unidades);
  const tituloFinal = String(titulo || '').trim()
    || [unidade, chamado.numero_registro != null ? `ID: ${chamado.numero_registro}` : '']
      .filter(Boolean)
      .join(' · ')
    || chamado.titulo
    || 'Laudo técnico';
  const grau = String(criticidade || 'media').toLowerCase();

  const payload = {
    condominio_id: condominioId,
    chamado_id: chamadoId,
    criado_por: userId,
    titulo: tituloFinal,
    descricao,
    criticidade: grau,
  };

  let { data: laudo, error } = await supabase
    .from('laudos_tecnicos')
    .insert(payload)
    .select('*')
    .single();
  if (error && /criticidade/i.test(error.message || '')) {
    delete payload.criticidade;
    const retry = await supabase.from('laudos_tecnicos').insert(payload).select('*').single();
    laudo = retry.data;
    error = retry.error;
  }
  if (error) throw error;

  const { error: convErr } = await supabase
    .from('conversas')
    .insert({
      condominio_id: condominioId,
      tipo: 'laudo',
      titulo: tituloFinal,
      laudo_id: laudo.id,
      chamado_id: chamadoId,
    });
  if (convErr && !ignoraDuplicado(convErr)) throw convErr;

  let convId = null;
  try {
    convId = await garantirChatLaudo(laudo.id, userId);
  } catch {
    convId = null;
  }

  const uploaded = [];
  for (const file of files || []) {
    const arquivo = await uploadArquivo({
      condominioId,
      userId,
      file,
      folder: `laudos/${laudo.id}`,
    });
    const { error: linkErr } = await supabase
      .from('laudo_arquivos')
      .insert({ laudo_id: laudo.id, arquivo_id: arquivo.id });
    if (linkErr) throw linkErr;
    uploaded.push(arquivo);
  }

  const abertura = String(descricao || '').trim();
  if (convId && (uploaded.length || abertura)) {
    const { data: msg, error: msgErr } = await supabase.from('mensagens').insert({
      conversa_id: convId,
      usuario_id: userId,
      texto: abertura || (uploaded.length ? 'Imagem' : ''),
    }).select('id').single();
    if (msgErr) throw msgErr;
    if (msg?.id && uploaded.length) {
      const { error: marqErr } = await supabase.from('mensagem_arquivos').insert(
        uploaded.map((arquivo) => ({ mensagem_id: msg.id, arquivo_id: arquivo.id })),
      );
      if (marqErr) throw marqErr;
    }
  }

  return laudo;
}

export async function resumoOperacionalCondominio(condominioId) {
  if (!condominioId) {
    return { aberto: 0, andamento: 0, concluido: 0, total: 0, manutencoes: 0, laudos: 0 };
  }
  const rpc = await supabase.rpc('resumo_operacional_condominio', { p_condominio_id: condominioId });
  if (!rpc.error && rpc.data) {
    const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    return {
      aberto: Number(row?.aberto || 0),
      andamento: Number(row?.andamento || 0),
      concluido: Number(row?.concluido || 0),
      total: Number(row?.total || 0),
      manutencoes: Number(row?.manutencoes || 0),
      laudos: Number(row?.laudos || 0),
    };
  }
  return null;
}

function mapLaudoGovernanca(row) {
  if (!row) return null;
  const chamado = embedOne(row.chamados) || (row.chamado_id
    ? {
      id: row.chamado_id,
      numero_registro: row.chamado_numero,
      titulo: row.chamado_titulo,
    }
    : null);
  const unidades = embedOne(row.unidades)
    || embedOne(chamado?.unidades)
    || (row.unidade_identificacao || row.unidade_bloco || row.unidade_andar
      ? {
        identificacao: row.unidade_identificacao,
        bloco: row.unidade_bloco,
        andar: row.unidade_andar,
      }
      : null);
  const capa = row.capa || (row.capa_storage_path
    ? {
      storage_path: row.capa_storage_path,
      mime_type: row.capa_mime,
      nome_original: row.capa_nome,
      tipo: row.capa_tipo,
    }
    : null);
  return {
    ...row,
    chamados: chamado ? { ...chamado, unidades: embedOne(chamado.unidades) || unidades } : chamado,
    unidades,
    capa,
    usuarios: embedOne(row.usuarios) || { nome: row.criador_nome || '' },
  };
}

async function hidratarCapasLaudos(rows) {
  const list = (rows || []).map(mapLaudoGovernanca);
  const semCapa = list.filter((row) => !row.capa?.storage_path && row.id);
  if (semCapa.length) {
    const { data } = await supabase
      .from('laudo_arquivos')
      .select('laudo_id, arquivos(*)')
      .in('laudo_id', semCapa.map((row) => row.id));
    const primeiro = {};
    for (const row of data || []) {
      if (primeiro[row.laudo_id]) continue;
      const arquivo = embedOne(row.arquivos);
      if (arquivo) primeiro[row.laudo_id] = arquivo;
    }
    for (const row of list) {
      if (!row.capa?.storage_path && primeiro[row.id]) row.capa = primeiro[row.id];
    }
  }
  return Promise.all(list.map(async (row) => {
    if (!row.capa?.storage_path) return row;
    return { ...row, capa: await resolverUrlArquivo(row.capa) };
  }));
}

async function listarLaudosDireto(condominioId) {
  const full = await supabase
    .from('laudos_tecnicos')
    .select('*, chamados(id, numero_registro, titulo, unidades(identificacao, bloco, andar)), usuarios:criado_por(nome)')
    .eq('condominio_id', condominioId)
    .order('created_at', { ascending: false });
  if (!full.error) return hidratarCapasLaudos(full.data || []);

  const plain = await supabase
    .from('laudos_tecnicos')
    .select('*')
    .eq('condominio_id', condominioId)
    .order('created_at', { ascending: false });
  if (plain.error) throw plain.error;
  return hidratarCapasLaudos(plain.data || []);
}

async function carregarLaudoDireto(laudoId) {
  const full = await supabase
    .from('laudos_tecnicos')
    .select('*, chamados(id, numero_registro, titulo, unidades(identificacao, bloco, andar)), usuarios:criado_por(nome)')
    .eq('id', laudoId)
    .single();
  if (!full.error) {
    const [row] = await hidratarCapasLaudos([full.data]);
    return row;
  }

  const plain = await supabase
    .from('laudos_tecnicos')
    .select('*')
    .eq('id', laudoId)
    .single();
  if (plain.error) throw plain.error;
  const [row] = await hidratarCapasLaudos([plain.data]);
  return row;
}

export async function listarLaudosGovernanca(condominioId) {
  if (!condominioId) return [];
  const rpc = await supabase.rpc('listar_laudos_governanca', { p_condominio_id: condominioId });
  if (!rpc.error && rpc.data) return hidratarCapasLaudos(rpc.data || []);
  if (rpc.error && !rpcAusente(rpc.error) && !rpcEstruturaIncompativel(rpc.error)) throw rpc.error;
  return listarLaudosDireto(condominioId);
}

export async function carregarLaudoGovernanca(laudoId) {
  if (!laudoId) return null;
  const rpc = await supabase.rpc('laudo_governanca', { p_laudo_id: laudoId });
  if (!rpc.error && rpc.data) {
    const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    if (row) {
      const [mapped] = await hidratarCapasLaudos([row]);
      return mapped;
    }
  }
  if (rpc.error && !rpcAusente(rpc.error) && !rpcEstruturaIncompativel(rpc.error)) throw rpc.error;
  return carregarLaudoDireto(laudoId);
}

export async function listarLaudosGlobais() {
  let { data, error } = await supabase
    .from('laudos_tecnicos')
    .select('*, chamados(id, numero_registro, titulo, unidades(identificacao, bloco, andar)), usuarios:criado_por(nome), condominios(id, nome)')
    .order('created_at', { ascending: false });
  if (error) {
    const plain = await supabase
      .from('laudos_tecnicos')
      .select('*, chamados(id, numero_registro, titulo, unidades(identificacao, bloco, andar)), usuarios:criado_por(nome)')
      .order('created_at', { ascending: false });
    data = plain.data;
    error = plain.error;
  }
  if (error) throw error;
  return hidratarCapasLaudos(data || []);
}

export async function atualizarCriticidadeLaudo(laudoId, criticidade) {
  const { error } = await supabase
    .from('laudos_tecnicos')
    .update({ criticidade: String(criticidade || 'media').toLowerCase() })
    .eq('id', laudoId);
  if (error) throw error;
}

export async function garantirChatLaudo(laudoId, userId) {
  const { data, error } = await supabase.rpc('garantir_chat_laudo', { p_laudo_id: laudoId });
  if (!error && data) return data;
  if (error && !rpcAusente(error)) throw error;

  const { data: laudo, error: lErr } = await supabase
    .from('laudos_tecnicos')
    .select('id, condominio_id, titulo, chamado_id')
    .eq('id', laudoId)
    .single();
  if (lErr) throw lErr;

  let { data: conv, error: convErr } = await supabase
    .from('conversas')
    .select('id')
    .eq('laudo_id', laudoId)
    .maybeSingle();
  if (convErr) throw convErr;

  if (!conv?.id) {
    const created = await supabase
      .from('conversas')
      .insert({
        condominio_id: laudo.condominio_id,
        tipo: 'laudo',
        titulo: laudo.titulo,
        laudo_id: laudoId,
        chamado_id: laudo.chamado_id,
      })
      .select('id')
      .single();
    if (created.error) {
      const again = await supabase.from('conversas').select('id').eq('laudo_id', laudoId).maybeSingle();
      if (!again.data?.id) throw created.error;
      conv = again.data;
    } else {
      conv = created.data;
    }
  }

  const part = await supabase.from('conversa_participantes').insert({
    conversa_id: conv.id,
    usuario_id: userId,
  });
  if (part.error && !ignoraDuplicado(part.error)) {
    await supabase
      .from('conversa_participantes')
      .update({ saiu_em: null })
      .eq('conversa_id', conv.id)
      .eq('usuario_id', userId);
  }
  return conv.id;
}

export async function enviarMensagemLaudo(laudoId, texto, userId) {
  const trimmed = String(texto || '').trim();
  if (!trimmed) throw new Error('Escreva a mensagem');

  const rpc = await supabase.rpc('enviar_mensagem_laudo', {
    p_laudo_id: laudoId,
    p_texto: trimmed,
  });
  if (!rpc.error) return rpc.data;
  if (!rpcAusente(rpc.error) && rpc.error.code !== '42501') throw rpc.error;

  const convId = await garantirChatLaudo(laudoId, userId);
  const { data, error } = await supabase
    .from('mensagens')
    .insert({
      conversa_id: convId,
      usuario_id: userId,
      texto: trimmed,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function enviarArquivoLaudo({ laudoId, condominioId, userId, file, caption }) {
  const convId = await garantirChatLaudo(laudoId, userId);
  const label = caption?.trim() || `Arquivo: ${file.name}`;
  const { data: msg, error: msgErr } = await supabase.from('mensagens').insert({
    conversa_id: convId,
    usuario_id: userId,
    texto: label,
  }).select('id').single();
  if (msgErr) throw msgErr;
  const arquivo = await uploadArquivo({
    condominioId,
    userId,
    file,
    folder: `mensagens/${msg.id}`,
  });
  await supabase.from('mensagem_arquivos').insert({
    mensagem_id: msg.id,
    arquivo_id: arquivo.id,
  });
  return { ...msg, anexos: [await resolverUrlArquivo(arquivo)] };
}

export async function criarLoginSemTrocarSessao({ email, password, nome, conviteToken }) {
  const { data, error } = await supabase.rpc('criar_login_app', {
    p_email: String(email || '').trim().toLowerCase(),
    p_senha: password,
    p_nome: nome || null,
    p_convite_token: conviteToken || null,
  });
  if (error) throw error;
  return data;
}

export async function criarUsuarioGestaoTecnica({ email, password, nome }) {
  const { data, error } = await supabase.rpc('criar_usuario_gestao_tecnica', {
    p_email: String(email || '').trim().toLowerCase(),
    p_senha: password,
    p_nome: nome || null,
  });
  if (error) throw error;
  return data;
}

export async function listarUsuariosGestaoTecnica() {
  const { data, error } = await supabase.rpc('listar_usuarios_gestao_tecnica');
  if (error) throw error;
  return data || [];
}

export async function vincularUsuario({ condominioId, cargo, usuarioId, email, unidadeTexto, nome }) {
  const { data, error } = await supabase.rpc('vincular_usuario_ao_condominio', {
    p_condominio_id: condominioId,
    p_cargo: cargo,
    p_usuario_id: usuarioId || null,
    p_email: email || null,
    p_unidade_texto: unidadeTexto || null,
    p_nome: nome || null,
  });
  if (error) {
    // Fallback se o SQL novo ainda não foi rodado (sem p_nome)
    const legacy = await supabase.rpc('vincular_usuario_ao_condominio', {
      p_condominio_id: condominioId,
      p_cargo: cargo,
      p_usuario_id: usuarioId || null,
      p_email: email || null,
      p_unidade_texto: unidadeTexto || null,
    });
    if (legacy.error) throw error;
    if (nome && (usuarioId || legacy.data)) {
      const uid = usuarioId || legacy.data;
      await supabase.from('usuarios').update({ nome }).eq('id', uid);
    }
    return legacy.data;
  }
  return data;
}

function formatUnidadeLabel(u) {
  return labelUnidade(u, '');
}

/** Lista usuários do condomínio com nome e unidade (para gestão). */
export async function listarUsuariosCondominio(condominioId) {
  if (!condominioId) return [];

  const rpc = await supabase.rpc('listar_usuarios_condominio', { p_condominio_id: condominioId });
  if (!rpc.error && Array.isArray(rpc.data)) {
    return rpc.data.map((row) => ({
      id: row.id,
      usuario_id: row.usuario_id,
      nome: row.nome || row.email || 'Usuário',
      email: row.email || '',
      telefone: row.telefone || '',
      unidade: row.unidade || 'Sem unidade',
      cargo: row.cargo || '',
      cargoTipo: row.cargo_tipo || '',
      ativo: row.ativo !== false,
      usuarios: {
        id: row.usuario_id,
        nome: row.nome,
        email: row.email,
        telefone: row.telefone,
        ativo: row.ativo !== false,
      },
      cargos: row.cargo_tipo || row.cargo
        ? { nome: row.cargo, tipo: row.cargo_tipo }
        : null,
    }));
  }

  // Se a RPC existe mas falhou (ex.: bug no SQL), mostra o erro real — não o aviso genérico
  if (rpc.error && !/PGRST202|Could not find.*listar_usuarios_condominio|does not exist/i.test(
    `${rpc.error.code || ''} ${rpc.error.message || ''}`,
  )) {
    throw new Error(rpc.error.message || 'Falha ao listar usuários do condomínio.');
  }

  const SQL_LISTAR =
    'No Supabase → SQL Editor, rode o arquivo supabase/listar-usuarios-condominio.sql (inteiro) e recarregue a página.';

  // Fallback (SQL ainda não aplicado): leitura direta costuma falhar por RLS
  const { data: links, error } = await supabase
    .from('usuario_condominio')
    .select('id, usuario_id, cargo_id, ativo, usuarios:usuario_id(id, nome, email, telefone, ativo), cargos:cargo_id(id, nome, tipo)')
    .eq('condominio_id', condominioId);

  let list = links || [];
  if (error || list.some((row) => !row.usuarios)) {
    const plain = await supabase
      .from('usuario_condominio')
      .select('id, usuario_id, cargo_id, ativo')
      .eq('condominio_id', condominioId);
    if (plain.error) throw new Error(SQL_LISTAR);
    list = plain.data || [];
  }

  const userIds = [...new Set(list.map((row) => row.usuario_id).filter(Boolean))];
  const cargoIds = [...new Set(list.map((row) => row.cargo_id).filter(Boolean))];

  const [{ data: users }, { data: cargos }, { data: moradias }] = await Promise.all([
    userIds.length
      ? supabase.from('usuarios').select('id, nome, email, telefone, ativo').in('id', userIds)
      : Promise.resolve({ data: [] }),
    cargoIds.length
      ? supabase.from('cargos').select('id, nome, tipo').in('id', cargoIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? supabase
        .from('unidade_moradores')
        .select('usuario_id, unidade_id, unidades(id, identificacao, bloco, condominio_id)')
        .in('usuario_id', userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const byUser = Object.fromEntries((users || []).map((u) => [u.id, u]));
  const byCargo = Object.fromEntries((cargos || []).map((c) => [c.id, c]));
  const unidadeByUser = {};

  for (const row of moradias || []) {
    const u = Array.isArray(row.unidades) ? row.unidades[0] : row.unidades;
    if (u?.condominio_id && u.condominio_id !== condominioId) continue;
    const label = formatUnidadeLabel(u);
    if (!row.usuario_id || !label) continue;
    if (!unidadeByUser[row.usuario_id]) unidadeByUser[row.usuario_id] = [];
    if (!unidadeByUser[row.usuario_id].includes(label)) unidadeByUser[row.usuario_id].push(label);
  }

  const mapped = list
    .map((row) => {
      const userRaw = row.usuarios;
      const user = (Array.isArray(userRaw) ? userRaw[0] : userRaw) || byUser[row.usuario_id] || null;
      const cargoRaw = row.cargos;
      const cargo = (Array.isArray(cargoRaw) ? cargoRaw[0] : cargoRaw) || byCargo[row.cargo_id] || null;
      return {
        id: row.id,
        usuario_id: row.usuario_id,
        ativo: row.ativo,
        nome: user?.nome || user?.email || 'Usuário',
        email: user?.email || '',
        telefone: user?.telefone || '',
        unidade: (unidadeByUser[row.usuario_id] || []).join(' · ') || 'Sem unidade',
        cargo: cargo?.nome || cargo?.tipo || '',
        cargoTipo: cargo?.tipo || '',
        usuarios: user,
        cargos: cargo,
      };
    })
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

  // Vínculos existem, mas RLS bloqueou nome/e-mail → falta a RPC
  if (mapped.length && mapped.every((r) => r.nome === 'Usuário' && !r.email)) {
    throw new Error(SQL_LISTAR);
  }

  return mapped;
}

function nomeFraco(nome) {
  const n = String(nome || '').trim();
  if (!n) return true;
  if (/^(morador|equipe|usu[aá]rio)(\s*\d+)?$/i.test(n)) return true;
  return false;
}

function nomePreenchido(nome) {
  return !nomeFraco(nome);
}

/** Resolve nomes reais (perfil + Auth) quando o embed `usuarios.nome` vem vazio por RLS. */
export async function mapNomesUsuarios(ids, condominioIds) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const map = {};
  if (!unique.length) return map;

  const rpc = await supabase.rpc('nomes_exibicao_usuarios', { p_ids: unique });
  if (!rpc.error && Array.isArray(rpc.data)) {
    for (const row of rpc.data) {
      const id = row.usuario_id || row.id;
      const nome = String(row.nome || '').trim();
      if (id && nome) map[id] = nome;
    }
  }

  let missing = unique.filter((id) => !map[id]);
  const condos = (Array.isArray(condominioIds) ? condominioIds : [condominioIds]).filter(Boolean);
  if (missing.length && condos.length) {
    await Promise.all(condos.map(async (cid) => {
      try {
        const users = await listarUsuariosCondominio(cid);
        for (const u of users || []) {
          const id = u.usuario_id || u.usuarios?.id;
          const nome = String(u.nome || u.usuarios?.nome || '').trim();
          if (id && nome) map[id] = nome;
        }
      } catch {
        /* listar exige staff/GT */
      }
    }));
    missing = unique.filter((id) => !map[id]);
  }

  if (missing.length) {
    const { data } = await supabase.from('usuarios').select('id, nome, email').in('id', missing);
    for (const u of data || []) {
      const nome = String(u.nome || '').trim();
      if (nome) map[u.id] = nome;
    }
  }
  return map;
}

export async function hidratarNomesChamados(chamados) {
  const list = (chamados || []).map((row) => ({
    ...row,
    usuarios: embedOne(row.usuarios),
    unidades: embedOne(row.unidades),
  }));
  if (!list.length) return list;

  const missing = [...new Set(
    list
      .filter((row) => row.solicitante_id && !nomePreenchido(row.usuarios?.nome))
      .map((row) => row.solicitante_id),
  )];
  if (!missing.length) return list;

  const condoIds = [...new Set(
    list
      .filter((row) => missing.includes(row.solicitante_id) && row.condominio_id)
      .map((row) => row.condominio_id),
  )];
  const map = await mapNomesUsuarios(missing, condoIds);
  return list.map((row) => {
    const nome = map[row.solicitante_id];
    if (!nome) return row;
    return {
      ...row,
      usuarios: { ...(row.usuarios || {}), id: row.solicitante_id, nome },
    };
  });
}

export async function hidratarNomesMensagens(mensagens, {
  solicitanteId,
  solicitanteNome,
  condominioId,
} = {}) {
  const list = (mensagens || []).map((m) => ({
    ...m,
    usuarios: embedOne(m.usuarios),
  }));
  const ids = [...new Set([
    solicitanteId,
    ...list.map((m) => m.usuario_id),
  ].filter(Boolean))];
  const map = await mapNomesUsuarios(ids, condominioId);
  if (solicitanteId && nomePreenchido(solicitanteNome) && !map[solicitanteId]) {
    map[solicitanteId] = String(solicitanteNome).trim();
  }
  return {
    nomes: map,
    mensagens: list.map((m) => {
      const nome = map[m.usuario_id]
        || m.usuarios?.nome
        || (m.usuario_id === solicitanteId ? map[solicitanteId] || solicitanteNome : '')
        || '';
      return { ...m, usuarios: { ...(m.usuarios || {}), nome } };
    }),
  };
}

export async function hidratarFotosMensagens(mensagens) {
  const list = mensagens || [];
  const ids = [...new Set(list.map((m) => m.usuario_id).filter(Boolean))];
  if (!ids.length) return list;
  let rows = [];
  const full = await supabase.from('usuarios').select('id, foto_path, gestao_tecnica').in('id', ids);
  if (!full.error) {
    rows = full.data || [];
  } else {
    const plain = await supabase.from('usuarios').select('id, foto_path').in('id', ids);
    rows = plain.data || [];
  }
  const fotos = {};
  const flags = {};
  await Promise.all((rows || []).map(async (row) => {
    flags[row.id] = Boolean(row.gestao_tecnica);
    if (row.foto_path) fotos[row.id] = await urlFotoUsuario(row.foto_path);
  }));
  return list.map((m) => ({
    ...m,
    usuarios: {
      ...(m.usuarios || {}),
      foto_url: fotos[m.usuario_id] || m.usuarios?.foto_url || '',
      gestao_tecnica: flags[m.usuario_id] ?? m.usuarios?.gestao_tecnica,
    },
  }));
}

export async function criarConvite({ condominioId, cargo, email, unidadeTexto }) {
  const { data, error } = await supabase.rpc('criar_convite', {
    p_condominio_id: condominioId,
    p_cargo: cargo,
    p_email: email || null,
    p_unidade_texto: unidadeTexto || null,
  });
  if (error) throw error;
  return data;
}

export async function listarConvites(condominioId) {
  const { data, error } = await supabase.rpc('listar_convites', { p_condominio_id: condominioId });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function verConvite(token) {
  const { data, error } = await supabase.rpc('ver_convite', { p_token: token });
  if (error) throw error;
  return data;
}

export async function aceitarConvite(token) {
  const { data, error } = await supabase.rpc('aceitar_convite', { p_token: token });
  if (error) throw error;
  return data;
}

export async function aceitarConviteCadastro(token, usuarioId) {
  const { data, error } = await supabase.rpc('aceitar_convite_cadastro', {
    p_token: token,
    p_usuario_id: usuarioId,
  });
  if (error) throw error;
  return data;
}

function normalizarRastreabilidadeRow(row) {
  const atendentes = (row.atendentes || []).map((a) => {
    const u = Array.isArray(a.usuarios) ? a.usuarios[0] : a.usuarios;
    return { id: a.usuario_id, nome: u?.nome || 'Usuário' };
  });
  const arquivos = (row.arquivos || []).map((a) => {
    const ar = Array.isArray(a.arquivos) ? a.arquivos[0] : a.arquivos;
    if (!ar?.id) return null;
    return { ...ar, descricao_foto: a.descricao_foto };
  }).filter(Boolean);
  const registrado = Array.isArray(row.registrado) ? row.registrado[0] : row.registrado;
  return { ...row, atendentes, arquivos, registrado };
}

export async function listarArquivosAberturaChamado(chamadoId) {
  const { data, error } = await supabase
    .from('chamado_arquivos')
    .select('arquivo_id, arquivos(*)')
    .eq('chamado_id', chamadoId);
  if (error) throw error;
  return (data || []).map((row) => {
    const ar = Array.isArray(row.arquivos) ? row.arquivos[0] : row.arquivos;
    return ar;
  }).filter(Boolean);
}

export async function juntarMensagensComAbertura(chamado, mensagens) {
  const list = mensagens || [];
  if (!chamado?.id) return list;
  let arquivos = [];
  try {
    arquivos = await listarArquivosAberturaChamado(chamado.id);
  } catch {
    return list;
  }
  const withUrl = (await Promise.all((arquivos || []).map(resolverUrlArquivo))).filter((file) => file?.id);
  if (!withUrl.length) return list;

  const aberturaIds = new Set(withUrl.map((file) => file.id));
  const marked = list.map((m) => {
    const anexos = m.anexos || [];
    const ids = anexos.map((a) => a.id).filter(Boolean);
    const ehAbertura = ids.length > 0 && ids.every((id) => aberturaIds.has(id));
    return ehAbertura ? { ...m, abertura: true } : m;
  });

  const seen = new Set();
  for (const m of marked) {
    for (const a of m.anexos || []) {
      if (a?.id) seen.add(a.id);
      if (a?.storage_path) seen.add(a.storage_path);
    }
  }
  const extras = withUrl.filter((file) => !seen.has(file.id) && !seen.has(file.storage_path));
  if (!extras.length) return marked;

  return [
    {
      id: `abertura-${chamado.id}`,
      usuario_id: chamado.solicitante_id,
      usuarios: embedOne(chamado.usuarios) || null,
      texto: '',
      created_at: chamado.created_at,
      anexos: extras,
      abertura: true,
      excluido_em: null,
    },
    ...marked,
  ];
}

export async function listarArquivosAberturaLaudo(laudoId) {
  const { data, error } = await supabase
    .from('laudo_arquivos')
    .select('arquivo_id, arquivos(*)')
    .eq('laudo_id', laudoId);
  if (error) throw error;
  return (data || []).map((row) => embedOne(row.arquivos)).filter(Boolean);
}

export async function juntarMensagensComAberturaLaudo(laudo, mensagens) {
  const list = mensagens || [];
  if (!laudo?.id) return list;

  let arquivos = [];
  try {
    arquivos = await listarArquivosAberturaLaudo(laudo.id);
  } catch {
    arquivos = [];
  }
  const withUrl = (await Promise.all((arquivos || []).map(resolverUrlArquivo))).filter((file) => file?.id);
  const descricao = String(laudo.descricao || '').trim();

  const aberturaIds = new Set(withUrl.map((file) => file.id));
  const marked = list.map((m) => {
    const anexos = m.anexos || [];
    const ids = anexos.map((a) => a.id).filter(Boolean);
    const ehAbertura = ids.length > 0 && ids.every((id) => aberturaIds.has(id));
    return ehAbertura ? { ...m, abertura: true } : m;
  });

  const seen = new Set();
  for (const m of marked) {
    for (const a of m.anexos || []) {
      if (a?.id) seen.add(a.id);
      if (a?.storage_path) seen.add(a.storage_path);
    }
  }
  const extras = withUrl.filter((file) => !seen.has(file.id) && !seen.has(file.storage_path));
  const descricaoJaNoChat = Boolean(descricao) && marked.some((m) => String(m.texto || '').trim() === descricao);
  if (!extras.length && (!descricao || descricaoJaNoChat)) return marked;

  return [
    {
      id: `abertura-laudo-${laudo.id}`,
      usuario_id: laudo.criado_por,
      usuarios: embedOne(laudo.usuarios) || { nome: laudo.criador_nome || '' },
      texto: descricaoJaNoChat ? '' : descricao,
      created_at: laudo.created_at,
      anexos: extras,
      abertura: true,
      excluido_em: null,
    },
    ...marked,
  ];
}

export async function listarRastreabilidadeChamado(chamadoId) {
  const { data, error } = await supabase
    .from('chamado_rastreabilidade')
    .select(`
      *,
      registrado:registrado_por(nome),
      atendentes:chamado_rastreabilidade_atendentes(
        usuario_id,
        usuarios:usuario_id(nome)
      ),
      arquivos:chamado_rastreabilidade_arquivos(
        id,
        descricao_foto,
        arquivos:arquivo_id(*)
      )
    `)
    .eq('chamado_id', chamadoId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(normalizarRastreabilidadeRow);
}

export async function proximoNumeroInspecao(chamadoId) {
  const { count, error } = await supabase
    .from('chamado_rastreabilidade')
    .select('id', { count: 'exact', head: true })
    .eq('chamado_id', chamadoId)
    .eq('tipo', 'inspecao');
  if (error) throw error;
  return (count || 0) + 1;
}

export async function registrarRastreabilidadeChamado({
  chamadoId,
  condominioId,
  userId,
  tipo,
  descricao,
  titulo,
  dataOcorrencia,
  parentId,
  numeroInspecao,
  atendenteIds = [],
  files = [],
  fileDescriptions = [],
}) {
  const payload = {
    chamado_id: chamadoId,
    tipo,
    descricao: descricao || null,
    titulo: titulo || null,
    registrado_por: userId,
    parent_id: parentId || null,
    numero_inspecao: tipo === 'inspecao' ? numeroInspecao : null,
    data_ocorrencia: dataOcorrencia || null,
  };

  const { data, error } = await supabase
    .from('chamado_rastreabilidade')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw new Error(formatDbError(error, 'chamado_rastreabilidade'));
  const regId = data.id;

  if (tipo === 'atendimento' && atendenteIds.length) {
    const { error: attErr } = await supabase.from('chamado_rastreabilidade_atendentes').insert(
      atendenteIds.map((uid) => ({ rastreabilidade_id: regId, usuario_id: uid })),
    );
    if (attErr) throw new Error(formatDbError(attErr, 'chamado_rastreabilidade_atendentes'));
  }

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!file) continue;
    const arquivo = await uploadArquivo({
      condominioId,
      userId,
      file,
      folder: `chamados/${chamadoId}/rastreabilidade/${regId}`,
    });
    const { error: fileErr } = await supabase.from('chamado_rastreabilidade_arquivos').insert({
      rastreabilidade_id: regId,
      arquivo_id: arquivo.id,
      descricao_foto: fileDescriptions[i] || null,
    });
    if (fileErr) throw new Error(formatDbError(fileErr, 'chamado_rastreabilidade_arquivos'));
  }

  return regId;
}

export async function agendarVisitaChamado({ chamadoId, condominioId, userId, data, horario }) {
  const titulo = tituloInspecaoAgendada(data, horario);
  const descricao = mensagemChatVisita(data, horario);
  const dataOcorrencia = isoAgendamento(data, horario);
  const payload = {
    chamadoId,
    condominioId,
    userId,
    titulo,
    descricao,
    dataOcorrencia,
  };

  try {
    await registrarRastreabilidadeChamado({ ...payload, tipo: TIPO_INSPECAO_AGENDADA });
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/check|tipo|inspecao_agendada|violates/i.test(msg)) throw err;
    await registrarRastreabilidadeChamado({ ...payload, tipo: 'atendimento' });
  }
}

export async function listarVisitasAgendadas(condoId) {
  const chamados = await listarChamadosCondominio(condoId);
  const ids = chamados.map((row) => row.id);
  if (!ids.length) return [];
  const eventos = await listarRastreabilidadeChamados(ids);
  const byId = Object.fromEntries(chamados.map((row) => [row.id, row]));
  return eventos
    .filter(eventoEhInspecaoAgendada)
    .map((evento) => ({ ...evento, chamado: byId[evento.chamado_id] || null }))
    .sort((a, b) => {
      const ta = new Date(a.data_ocorrencia || a.created_at).getTime();
      const tb = new Date(b.data_ocorrencia || b.created_at).getTime();
      return ta - tb;
    });
}

export async function listarAgendamentosVisitaChamado(chamadoId) {
  if (!chamadoId) return [];
  const { data, error } = await supabase
    .from('chamado_rastreabilidade')
    .select('id, tipo, titulo, descricao, data_ocorrencia, created_at, chamado_id')
    .eq('chamado_id', chamadoId)
    .order('data_ocorrencia', { ascending: true });
  if (error) return [];
  return (data || []).filter(eventoEhInspecaoAgendada);
}

export async function resolverVisitaAgendadaChamado(chamadoId, mensagens = []) {
  const rows = await listarAgendamentosVisitaChamado(chamadoId);
  return proximaVisitaAgendada(rows) || visitaAgendadaDeMensagens(mensagens);
}

async function inChunks(ids, loadSlice) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const out = [];
  for (let i = 0; i < unique.length; i += 80) {
    const slice = unique.slice(i, i + 80);
    const rows = await loadSlice(slice);
    out.push(...(rows || []));
  }
  return out;
}

export async function periodoPadraoChamados(condoId) {
  const first = await supabase
    .from('chamados')
    .select('created_at')
    .eq('condominio_id', condoId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (first.error) throw first.error;
  return first.data?.created_at || new Date().toISOString();
}

export async function listarChamadosCondominio(condoId) {
  const full = await supabase
    .from('chamados')
    .select('*, usuarios:solicitante_id(nome), unidades(id, identificacao, bloco, andar), locais(id, nome)')
    .eq('condominio_id', condoId)
    .order('created_at', { ascending: true });
  if (!full.error) return full.data || [];
  if (!/locais|schema cache|could not find/i.test(String(full.error.message || ''))) {
    throw full.error;
  }
  const fallback = await supabase
    .from('chamados')
    .select('*, usuarios:solicitante_id(nome), unidades(id, identificacao, bloco, andar)')
    .eq('condominio_id', condoId)
    .order('created_at', { ascending: true });
  if (fallback.error) throw fallback.error;
  return fallback.data || [];
}

export async function listarRastreabilidadeChamados(chamadoIds) {
  return inChunks(chamadoIds, async (ids) => {
    const { data, error } = await supabase
      .from('chamado_rastreabilidade')
      .select(`
        *,
        registrado:registrado_por(nome),
        atendentes:chamado_rastreabilidade_atendentes(
          usuario_id,
          usuarios:usuario_id(nome)
        ),
        arquivos:chamado_rastreabilidade_arquivos(
          id,
          descricao_foto,
          arquivos:arquivo_id(*)
        )
      `)
      .in('chamado_id', ids)
      .order('created_at', { ascending: true });
    if (error) {
      if (/schema cache|could not find|does not exist/i.test(String(error.message || ''))) return [];
      throw error;
    }
    return (data || []).map(normalizarRastreabilidadeRow);
  });
}

export async function listarHistoricoStatusChamados(chamadoIds) {
  return inChunks(chamadoIds, async (ids) => {
    const { data, error } = await supabase
      .from('chamado_status_historico')
      .select('*, usuarios:alterado_por(nome)')
      .in('chamado_id', ids)
      .order('created_at');
    if (error) throw error;
    return data || [];
  });
}

export async function listarArquivosAberturaChamados(chamadoIds) {
  return inChunks(chamadoIds, async (ids) => {
    const { data, error } = await supabase
      .from('chamado_arquivos')
      .select('chamado_id, arquivo_id, arquivos(*)')
      .in('chamado_id', ids);
    if (error) throw error;
    return (data || []).map((row) => {
      const ar = Array.isArray(row.arquivos) ? row.arquivos[0] : row.arquivos;
      return ar ? { ...ar, chamado_id: row.chamado_id } : null;
    }).filter(Boolean);
  });
}
