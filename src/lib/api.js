import { supabase } from './supabase';
import { fileKind } from './format.js';
import { buildCondoSeed } from './parseSeed.js';
import { TIPO_LOCAL } from './permissions.js';

const CAPA_MAX_BYTES = 20 * 1024 * 1024;
const CAPA_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

async function compactarImagem(file, { maxWidth, quality }) {
  if (!file?.type?.startsWith('image/') || file.type === 'image/svg+xml') return file;
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
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function uploadArquivo({ condominioId, userId, file, folder, fileName, quality }) {
  if (!file) throw new Error('Selecione um arquivo.');
  const originalQuality = quality === 'original'
    || (folder === 'marca' && String(fileName || '').toLowerCase().startsWith('capa.'));

  if (originalQuality) {
    if (!CAPA_TYPES.has(String(file.type || '').toLowerCase()) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      throw new Error('A capa deve ser JPG, PNG ou WebP.');
    }
    if (file.size > CAPA_MAX_BYTES) {
      throw new Error('A capa pode ter até 20 MB para manter a qualidade.');
    }
  } else if (file.type?.startsWith('image/') && file.type !== 'image/svg+xml') {
    const compacted = await compactarImagem(file, { maxWidth: 1600, quality: 0.72 });
    if (compacted !== file && fileName) {
      fileName = String(fileName).replace(/\.[^.]+$/, '.jpg');
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

async function ignoreMissing(error) {
  if (!error) return;
  const msg = String(error.message || error.details || '');
  if (/schema cache|could not find|does not exist|column/i.test(msg)) return;
  throw error;
}

async function insertRows(table, rows) {
  if (!rows?.length) return;
  const { error } = await supabase.from(table).insert(rows);
  await ignoreMissing(error);
}

async function findOrCreate(table, match, payload) {
  const { data: existing } = await supabase.from(table).select('id').match(match).maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await supabase.from(table).insert(payload).select('id').single();
  if (error) {
    await ignoreMissing(error);
    return null;
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
    cnpj: row.cnpj || null,
    telefone: row.telefone || null,
    email: row.email || null,
    cidade: row.cidade || null,
  })));
  await insertRows('materiais', seed.materiais.map((row) => ({
    condominio_id: condoId,
    nome: row.nome,
    codigo: row.codigo || null,
    fabricante: row.fabricante || null,
    modelo: row.modelo || null,
    descricao: row.descricao || null,
  })));
  await insertRows('locais', seed.locais.map((row) => ({
    condominio_id: condoId,
    nome: row.nome,
    tipo: TIPO_LOCAL[row.tipo] ? row.tipo : 'outro',
    bloco: row.bloco || null,
    descricao: row.descricao || null,
  })));
  await insertRows('garantias', seed.garantias.map((row) => ({
    condominio_id: condoId,
    nome: row.nome,
    descricao: row.descricao || null,
  })));
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
        await insertRows('material_locais', [{ material_id: materialId, local_id: localId }]);
      } catch { /* vínculo complementar */ }
    }
    if (materialId && garantiaId) {
      try {
        await insertRows('material_garantias', [{ material_id: materialId, garantia_id: garantiaId }]);
      } catch { /* vínculo complementar */ }
    }
    if (fornecedorId && garantiaId) {
      try {
        await insertRows('fornecedor_garantias', [{ fornecedor_id: fornecedorId, garantia_id: garantiaId }]);
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

export async function criarCondominio(form, userId) {
  const seed = buildCondoSeed(form);
  const { data: condoId, error } = await supabase.rpc('criar_condominio', {
    p_nome: form.nome,
    p_cnpj: form.cnpj || null,
    p_descricao: form.descricao || null,
    p_cep: form.cep || null,
    p_logradouro: form.logradouro || null,
    p_numero: form.numero || null,
    p_complemento: form.complemento || null,
    p_bairro: form.bairro || null,
    p_cidade: form.cidade || null,
    p_estado: form.estado || null,
  });
  if (error) throw error;
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
      quality: tipo === 'capa' ? 'original' : 'compact',
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
      /* documento opcional */
    }
  }

  return condoId;
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

export async function vincularUsuario({ condominioId, cargo, usuarioId, email, unidadeTexto }) {
  const { data, error } = await supabase.rpc('vincular_usuario_ao_condominio', {
    p_condominio_id: condominioId,
    p_cargo: cargo,
    p_usuario_id: usuarioId || null,
    p_email: email || null,
    p_unidade_texto: unidadeTexto || null,
  });
  if (error) throw error;
  return data;
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
