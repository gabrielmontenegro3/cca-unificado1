import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { publicOrSignedUrl, uploadArquivo } from '../lib/api';
import { Alert, Btn, Field, Page } from '../components/ui';

function mensagemErro(err) {
  const msg = String(err?.message || err || '');
  if (/manuais_uso|schema cache|does not exist|42P01|PGRST204/i.test(msg)) {
    return 'Rode o arquivo supabase/manual-uso.sql no SQL Editor do Supabase e tente de novo.';
  }
  return msg || 'Não foi possível concluir.';
}

function ehPdf(file) {
  return file?.type === 'application/pdf' || String(file?.name || '').toLowerCase().endsWith('.pdf');
}

export function ManualUsoPage() {
  const { condoId, session, isGestaoTecnica } = useSession();
  const [url, setUrl] = useState('');
  const [nome, setNome] = useState('');
  const [arquivoId, setArquivoId] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);

  async function load() {
    if (!condoId) return;
    setError('');
    const { data, error: err } = await supabase
      .from('manuais_uso')
      .select('arquivo_id, arquivos(id, nome_original, storage_path, mime_type)')
      .eq('condominio_id', condoId)
      .maybeSingle();
    if (err) {
      setError(mensagemErro(err));
      setUrl('');
      return;
    }
    const arquivo = Array.isArray(data?.arquivos) ? data.arquivos[0] : data?.arquivos;
    if (!arquivo?.storage_path) {
      setUrl('');
      setNome('');
      setArquivoId('');
      return;
    }
    const assinado = await publicOrSignedUrl(arquivo.storage_path);
    setArquivoId(arquivo.id || data.arquivo_id || '');
    setNome(arquivo.nome_original || 'Manual de uso.pdf');
    setUrl(assinado.data?.signedUrl || '');
  }

  useEffect(() => { load(); }, [condoId]);

  async function publicar(e) {
    e.preventDefault();
    if (!ehPdf(file)) {
      setError('Envie o manual em PDF.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const arquivo = await uploadArquivo({
        condominioId: condoId,
        userId: session.user.id,
        file,
        folder: 'manuais-uso',
      });
      const { error: err } = await supabase.from('manuais_uso').upsert({
        condominio_id: condoId,
        arquivo_id: arquivo.id,
        updated_at: new Date().toISOString(),
      });
      if (err) throw err;
      if (arquivoId && arquivoId !== arquivo.id) {
        await supabase.from('arquivos').delete().eq('id', arquivoId);
      }
      setFile(null);
      setFileKey((value) => value + 1);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Manual de uso"
      lead={isGestaoTecnica ? 'Publique o PDF que o morador vê ao abrir esta tela.' : ''}
      className="page-manual-uso"
    >
      <Alert error={error} />
      {isGestaoTecnica ? (
        <form className="panel stack manual-uso-form" onSubmit={publicar}>
          <Field label={nome ? `Substituir “${nome}”` : 'Arquivo PDF'}>
            <input
              key={fileKey}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
          </Field>
          <Btn type="submit" icon="check" disabled={busy}>{busy ? 'Publicando…' : 'Publicar manual'}</Btn>
        </form>
      ) : null}
      {url ? (
        <iframe className="manual-uso-frame" title="Manual de uso" src={url} />
      ) : (
        <p className="meu-imovel-empty">Nenhum manual publicado ainda.</p>
      )}
    </Page>
  );
}
