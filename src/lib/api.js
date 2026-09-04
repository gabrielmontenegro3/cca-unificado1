import { supabase } from './supabase';
import { fileKind, formatDbError, normalizarCnpj } from './format.js';
import { buildCondoSeed, validarCriacaoCondominio } from './parseSeed.js';
import { normalizarDominio } from './branding.js';
import {
  TIPO_INSPECAO_AGENDADA,
  eventoEhInspecaoAgendada,
  isoAgendamento,
  mensagemChatVisita,
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

async function insertRows(table, rows, optionalKeys = []) {
  if (!rows?.length) return;
  const { error } = await supabase.from(table).insert(rows);
  if (!error) return;
  const msg = String(error.message || error.details || '');
  // Coluna ainda não existe — tenta de novo sem os campos opcionais
  if (optionalKeys.length && /schema cache|could not find|does not exist|column/i.test(msg)) {
    const stripped = rows.map((row) => {
      const next = { ...row };
      for (const key of optionalKeys) delete next[key];
      return next;
    });
    return insertRows(table, stripped);
  }
  // Coluna/tabela ainda não existe no schema — ignora partes opcionais do seed
  if (/schema cache|could not find|does not exist|column/i.test(msg)) return;
  // Duplicata em listas/vínculos — segue
  if (error.code === '23505' || /duplicate key|unique constraint/i.test(msg)) return;
  throw new Error(formatDbError(error, table));
}

async function upsertJoin(table, row, conflict) {
  const { error } = await supabase.from(table).upsert(row, {
    onConflict: conflict,
    ignoreDuplicates: true,
  });
  if (!error) return;
  const msg = String(error.message || error.details || '');
  if (/schema cache|could not find|does not exist|column/i.test(msg)) return;
  if (error.code === '23505' || /duplicate key|unique constraint/i.test(msg)) return;
  throw new Error(formatDbError(error, table));
}

async function findOrCreate(table, match, payload) {
  const selectCols = table === 'materiais' ? 'id, fornecedor_id' : 'id';
  const { data: existing } = await supabase.from(table).select(selectCols).match(match).maybeSingle();
  if (existing?.id) {
    // Reforça vínculo material → fornecedor quando a linha base já existia
    if (table === 'materiais' && payload?.fornecedor_id && existing.fornecedor_id !== payload.fornecedor_id) {
      await supabase.from('materiais').update({ fornecedor_id: payload.fornecedor_id }).eq('id', existing.id);
    }
    return existing.id;
  }
  const { data, error } = await supabase.from(table).insert(payload).select('id').single();
  if (error) {
    const msg = String(error.message || error.details || '');
    if (/schema cache|could not find|does not exist|column/i.test(msg)) return null;
    if (error.code === '23505' || /duplicate key|unique constraint/i.test(msg)) {
      const again = await supabase.from(table).select('id').match(match).maybeSingle();
      return again.data?.id || null;
    }
    throw new Error(formatDbError(error, table));
  }
  return data?.id || null;
}

async function popularCondominioCliente(condoId, seed, userId) {
  if (seed.visao_geral) {
    await insertRows('visao_geral_secoes', [{ condominio_id: condoId, titulo: 'Visão geral', texto: seed.visao_geral, ordem: 0 }]);
  }
  if (seed.sobre_empreendimento) {
    await insertRows('empreendimento_secoes', [{ condominio_id: condoId, titulo: 'Sobre o empreendimento', texto: seed.sobre_empreendimento, ordem: 0 }]);
  }
  if (seed.sobre_nos) {
    await insertRows('sobre_nos', [{ condominio_id: condoId, titulo: 'Sobre nós', texto: seed.sobre_nos, ordem: 0 }]);
  }
  if (seed.assistencia_tecnica) {
    await insertRows('visao_geral_secoes', [{ condominio_id: condoId, titulo: 'Assistência técnica', texto: seed.assistencia_tecnica, ordem: 1 }]);
  }
  if (seed.boletim_titulo && seed.boletim_texto) {
    await insertRows('boletins_informativos', [{
      condominio_id: condoId,
      autor_id: userId,
      titulo: seed.boletim_titulo,
      texto: seed.boletim_texto,
      publicado: true,
      data_publicacao: new Date().toISOString(),
    }]);
  }
  if (seed.email) {
    await insertRows('contatos', [{ condominio_id: condoId, nome: 'Condomínio', email: seed.email, ordem: 0, ativo: true }]);
  }

  await insertRows('fornecedores', seed.fornecedores.map((row) => ({
    condominio_id: condoId,
    nome: row.nome,
    cnpj: normalizarCnpj(row.cnpj),
    contato: row.contato || null,
    telefone: row.telefone || null,
    telefone1: row.telefone1 || null,
    telefone2: row.telefone2 || null,
    localizacao: row.localizacao || null,
  })), ['telefone1', 'telefone2', 'localizacao', 'contato']);
  await insertRows('materiais', seed.materiais.map((row) => ({
    condominio_id: condoId,
    nome: row.nome,
  })));
  await insertRows('locais', seed.locais.map((row) => ({
    condominio_id: condoId,
    nome: row.nome,
    tipo: 'outro',
    descricao: row.descricao || null,
  })));
  await insertRows('garantias', seed.garantias.map((row) => {
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
      telefone: row.telefone || null,
    };
  }), ['telefone', 'prazo_valor', 'prazo_unidade', 'data_fim', 'motivos_perda_garantia']);
  await insertRows('unidades', seed.unidades.map((row) => ({
    condominio_id: condoId,
    identificacao: row.identificacao,
    bloco: row.bloco || null,
    andar: row.andar || null,
  })));
  await insertRows('contatos', seed.contatos.map((row, index) => ({
    condominio_id: condoId,
    nome: row.nome,
    telefone: row.telefone || null,
    email: row.email || null,
    subtitulo: row.subtitulo || null,
    ordem: index + 1,
    ativo: true,
  })));

  for (const linha of seed.linhas_base || []) {
    let fornecedorId = null;
    let materialId = null;
    let localId = null;
    let garantiaId = null;
    if (linha.fornecedor) {
      fornecedorId = await findOrCreate('fornecedores', { condominio_id: condoId, nome: linha.fornecedor }, {
        condominio_id: condoId,
        nome: linha.fornecedor,
      });
    }
    if (linha.material) {
      materialId = await findOrCreate('materiais', { condominio_id: condoId, nome: linha.material }, {
        condominio_id: condoId,
        nome: linha.material,
        fornecedor_id: fornecedorId,
      });
    }
    if (linha.local) {
      localId = await findOrCreate('locais', { condominio_id: condoId, nome: linha.local }, {
        condominio_id: condoId,
        nome: linha.local,
        tipo: 'outro',
      });
    }
    if (linha.garantia) {
      garantiaId = await findOrCreate('garantias', { condominio_id: condoId, nome: linha.garantia }, {
        condominio_id: condoId,
        nome: linha.garantia,
      });
    }
    if (materialId && localId) {
      try {
        await upsertJoin('material_locais', { material_id: materialId, local_id: localId }, 'material_id,local_id');
      } catch { /* vínculo complementar */ }
    }
    if (materialId && garantiaId) {
      try {
        await upsertJoin('material_garantias', { material_id: materialId, garantia_id: garantiaId }, 'material_id,garantia_id');
      } catch { /* vínculo complementar */ }
    }
    if (fornecedorId && garantiaId) {
      try {
        await upsertJoin('fornecedor_garantias', { fornecedor_id: fornecedorId, garantia_id: garantiaId }, 'fornecedor_id,garantia_id');
      } catch { /* vínculo complementar */ }
    }
  }

  for (const user of seed.usuarios || []) {
    if (!user.email) continue;
    const { data: profile } = await supabase.from('usuarios').select('id').eq('email', user.email).maybeSingle();
    if (!profile?.id) continue;
    const cargoTipo = String(user.cargo || 'morador').toLowerCase().replace(/\s+/g, '_');
    const { data: cargo } = await supabase.from('cargos').select('id').eq('tipo', cargoTipo).maybeSingle();
    await insertRows('usuario_condominio', [{
      usuario_id: profile.id,
      condominio_id: condoId,
      cargo_id: cargo?.id || null,
      ativo: true,
    }]);
  }
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

    await popularCondominioCliente(condoId, seed, userId);

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

    const logo = await saveNamedImage(form.logo, 'marca', 'Logo', 'logo');
    await saveNamedImage(form.imagem_visao_geral, 'marca', 'Imagem visão geral', 'visao_geral');
    await saveNamedImage(form.imagem_capa, 'marca', 'Imagem capa', 'capa');
    await saveNamedImage(form.imagem_login, 'marca', 'Imagem login', 'login');
    if (logo?.storage_path) {
      await supabase.from('condominios').update({ logo_path: logo.storage_path }).eq('id', condoId);
    }

    for (const file of form.imagens || []) {
      await saveNamedImage(file, 'imagens', file.name);
    }
    for (const file of form.documentos || []) {
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
    }

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

export async function criarChamado({ condominioId, userId, titulo, descricao, files }) {
  const { data, error } = await supabase.rpc('abrir_chamado', {
    p_condominio_id: condominioId,
    p_titulo: titulo,
    p_descricao: descricao || null,
  });
  if (error) throw error;
  const chamado = typeof data === 'string' ? JSON.parse(data) : data;
  if (!chamado?.id) throw new Error('Não foi possível abrir o chamado.');

  for (const file of files || []) {
    const arquivo = await uploadArquivo({
      condominioId,
      userId,
      file,
      folder: `chamados/${chamado.id}`,
    });
    await supabase.from('chamado_arquivos').insert({ chamado_id: chamado.id, arquivo_id: arquivo.id });
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

export async function criarLaudo({ condominioId, userId, chamadoId, titulo, descricao, files }) {
  if (!chamadoId) throw new Error('Selecione o chamado relacionado a este laudo.');

  const { data: chamado, error: chErr } = await supabase
    .from('chamados')
    .select('id, condominio_id, titulo, numero_registro')
    .eq('id', chamadoId)
    .single();
  if (chErr) throw chErr;
  if (chamado.condominio_id !== condominioId) {
    throw new Error('O chamado precisa ser deste condomínio.');
  }

  const { data: laudo, error } = await supabase
    .from('laudos_tecnicos')
    .insert({
      condominio_id: condominioId,
      chamado_id: chamadoId,
      criado_por: userId,
      titulo,
      descricao,
    })
    .select('*')
    .single();
  if (error) throw error;

  const { error: convErr } = await supabase
    .from('conversas')
    .insert({
      condominio_id: condominioId,
      tipo: 'laudo',
      titulo,
      laudo_id: laudo.id,
      chamado_id: chamadoId,
    });
  if (convErr && !ignoraDuplicado(convErr)) throw convErr;

  for (const file of files || []) {
    const arquivo = await uploadArquivo({
      condominioId,
      userId,
      file,
      folder: `laudos/${laudo.id}`,
    });
    await supabase.from('laudo_arquivos').insert({ laudo_id: laudo.id, arquivo_id: arquivo.id });
  }

  return laudo;
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
  if (!u) return '';
  const id = (u.identificacao || '').trim();
  const bloco = (u.bloco || '').trim();
  if (bloco && id) return `${bloco} · ${id}`;
  return id || bloco || '';
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

  await enviarMensagemChamado(chamadoId, descricao, userId);
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
    .select('*, usuarios:solicitante_id(nome), unidades(id, identificacao), locais(id, nome)')
    .eq('condominio_id', condoId)
    .order('created_at', { ascending: true });
  if (!full.error) return full.data || [];
  if (!/locais|schema cache|could not find/i.test(String(full.error.message || ''))) {
    throw full.error;
  }
  const fallback = await supabase
    .from('chamados')
    .select('*, usuarios:solicitante_id(nome), unidades(id, identificacao)')
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
