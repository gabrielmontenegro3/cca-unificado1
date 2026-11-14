import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { publicOrSignedUrl, uploadArquivo } from '../lib/api';
import { Alert, Btn, Field, Page } from '../components/ui';
import { Icon } from '../components/icons';

const SQL_MULTIPLOS = 'supabase/arquivos-topo-multiplos.sql';

function mensagemErro(err) {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');
  // Chave antiga (um manual por condomínio) ou colunas novas ausentes.
  if (code === '23505' || /duplicate key|manuais_uso\.(id|ordem)|column .*(ordem|created_at)/i.test(msg)) {
    return `Para publicar mais de um manual, rode ${SQL_MULTIPLOS} no SQL Editor do Supabase e tente de novo.`;
  }
  if (/manuais_uso|schema cache|does not exist|42P01|PGRST204/i.test(msg)) {
    return 'Rode o arquivo supabase/manual-uso.sql no SQL Editor do Supabase e tente de novo.';
  }
  return msg || 'Não foi possível concluir.';
}

function ehPdf(file) {
  return file?.type === 'application/pdf' || String(file?.name || '').toLowerCase().endsWith('.pdf');
}

function nomeManual(manual) {
  return String(manual?.nome_original || 'Manual de uso.pdf').replace(/\.pdf$/i, '');
}

export function ManualUsoPage() {
  const { condoId, session, isGestaoTecnica } = useSession();
  const [manuais, setManuais] = useState([]);
  const [atualId, setAtualId] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);

  async function load() {
    if (!condoId) return;
    setError('');
    let { data, error: err } = await supabase
      .from('manuais_uso')
      .select('id, ordem, arquivo_id, arquivos(id, nome_original, storage_path, mime_type)')
      .eq('condominio_id', condoId)
      .order('ordem')
      .order('created_at');
    let antigo = false;
    if (err && /column|does not exist/i.test(String(err.message || '')) && !/manuais_uso"? does not exist|relation/i.test(String(err.message || ''))) {
      antigo = true;
      ({ data, error: err } = await supabase
        .from('manuais_uso')
        .select('arquivo_id, arquivos(id, nome_original, storage_path, mime_type)')
        .eq('condominio_id', condoId));
    }
    if (err) {
      setError(mensagemErro(err));
      setManuais([]);
      return;
    }
    setAviso(antigo && isGestaoTecnica ? `Para publicar mais de um manual, rode ${SQL_MULTIPLOS} no SQL Editor do Supabase.` : '');
    const lista = await Promise.all((data || []).map(async (row) => {
      const arquivo = Array.isArray(row.arquivos) ? row.arquivos[0] : row.arquivos;
      if (!arquivo?.storage_path) return null;
      const assinado = await publicOrSignedUrl(arquivo.storage_path);
      return {
        ...arquivo,
        vinculoId: row.id || '',
        ordem: row.ordem || 0,
        url: assinado.data?.signedUrl || '',
      };
    }));
    const validos = lista.filter(Boolean);
    setManuais(validos);
    setAtualId((atual) => (validos.some((m) => m.id === atual) ? atual : validos[0]?.id || ''));
  }

  useEffect(() => { load(); }, [condoId]);

  async function publicar(e) {
    e.preventDefault();
    if (!files.length) {
      setError('Escolha o PDF do manual.');
      return;
    }
    if (!files.every(ehPdf)) {
      setError('Envie os manuais em PDF.');
      return;
    }
    setBusy(true);
    setError('');
    const enviados = [];
    try {
      let proxima = manuais.reduce((max, item) => Math.max(max, (item.ordem || 0) + 1), 0);
      let ultimoId = '';
      for (const file of files) {
        const arquivo = await uploadArquivo({
          condominioId: condoId,
          userId: session.user.id,
          file,
          folder: 'manuais-uso',
        });
        enviados.push(arquivo.id);
        const { error: err } = await supabase.from('manuais_uso').insert({
          condominio_id: condoId,
          arquivo_id: arquivo.id,
          ordem: proxima,
          updated_at: new Date().toISOString(),
        });
        if (err) throw err;
        proxima += 1;
        ultimoId = arquivo.id;
      }
      setFiles([]);
      setFileKey((value) => value + 1);
      await load();
      if (ultimoId) setAtualId(ultimoId);
    } catch (err) {
      // Remove só o arquivo que não chegou a ser vinculado.
      const ultimo = enviados[enviados.length - 1];
      if (ultimo) await supabase.from('arquivos').delete().eq('id', ultimo);
      setError(mensagemErro(err));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remover(manual) {
    if (!manual?.id) return;
    if (!window.confirm(`Remover o manual “${nomeManual(manual)}”?`)) return;
    setBusy(true);
    setError('');
    try {
      const query = supabase.from('manuais_uso').delete();
      const { error: err } = manual.vinculoId
        ? await query.eq('id', manual.vinculoId)
        : await query.eq('condominio_id', condoId).eq('arquivo_id', manual.id);
      if (err) throw err;
      await supabase.from('arquivos').delete().eq('id', manual.id);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  const atual = manuais.find((m) => m.id === atualId) || manuais[0] || null;

  return (
    <Page
      title="Manual de uso"
      lead={isGestaoTecnica ? 'Publique os PDFs que o morador vê ao abrir esta tela. Um novo PDF é adicionado aos que já existem.' : ''}
      className="page-manual-uso"
    >
      <Alert error={error} />
      {aviso ? <p className="hint">{aviso}</p> : null}
      {isGestaoTecnica ? (
        <form className="panel stack manual-uso-form" onSubmit={publicar}>
          <Field label={manuais.length ? 'Adicionar outro manual (PDF)' : 'Arquivo PDF'}>
            <input
              key={fileKey}
              type="file"
              multiple
              accept="application/pdf,.pdf"
              onChange={(e) => setFiles([...(e.target.files || [])])}
              required
            />
          </Field>
          <Btn type="submit" icon="check" disabled={busy}>
            {busy ? 'Publicando…' : (manuais.length ? 'Adicionar manual' : 'Publicar manual')}
          </Btn>
        </form>
      ) : null}

      {manuais.length > 1 || (isGestaoTecnica && manuais.length) ? (
        <div className="manual-uso-abas" role="tablist" aria-label="Manuais">
          {manuais.map((manual) => (
            <span key={manual.vinculoId || manual.id} className={`manual-uso-aba${atual?.id === manual.id ? ' is-on' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={atual?.id === manual.id}
                title={nomeManual(manual)}
                onClick={() => setAtualId(manual.id)}
              >
                {nomeManual(manual)}
              </button>
              {isGestaoTecnica ? (
                <button
                  type="button"
                  className="manual-uso-remover"
                  disabled={busy}
                  aria-label={`Remover ${nomeManual(manual)}`}
                  title="Remover"
                  onClick={() => remover(manual)}
                >
                  <Icon name="x" size={14} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {atual?.url ? (
        <iframe key={atual.id} className="manual-uso-frame" title={nomeManual(atual)} src={atual.url} />
      ) : (
        <p className="meu-imovel-empty">Nenhum manual publicado ainda.</p>
      )}
    </Page>
  );
}
