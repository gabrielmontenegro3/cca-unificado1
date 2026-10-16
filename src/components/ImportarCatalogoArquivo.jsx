import { useRef, useState } from 'react';
import {
  analisarArquivoCatalogo,
  lerArquivoComoTexto,
  mesclarAnalises,
  mesclarTextoCampo,
} from '../lib/importCatalogoArquivo';
import { Alert, Btn } from './ui';
import { Modal } from './DataList';
import { Icon } from './icons';

export function ImportarCatalogoArquivo({ values, onApply, onMessage }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState({});
  const [modo, setModo] = useState('acrescentar');

  function resetPreview() {
    setPreview(null);
    setSelected({});
  }

  function montarPreview(analise) {
    if (!analise.total) {
      setError(analise.avisos?.[0] || 'Nenhum item identificado nos arquivos.');
      resetPreview();
      return;
    }
    const sel = {};
    for (const sec of analise.secoes) {
      sel[sec.key] = Object.fromEntries(sec.items.map((_, idx) => [idx, true]));
    }
    setSelected(sel);
    setPreview(analise);
    setError('');
  }

  function onPickFiles(e) {
    const picked = [...(e.target.files || [])];
    e.target.value = '';
    if (!picked.length) return;
    setFiles((prev) => {
      const names = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const next = [...prev];
      for (const file of picked) {
        const key = `${file.name}:${file.size}`;
        if (!names.has(key)) next.push(file);
      }
      return next;
    });
    setError('');
  }

  function removerArquivo(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function analisarArquivos() {
    if (!files.length) {
      setError('Selecione ao menos um arquivo.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const analises = [];
      for (const file of files) {
        const text = await lerArquivoComoTexto(file);
        const analise = analisarArquivoCatalogo(text);
        analises.push({ ...analise, origem: file.name });
      }
      montarPreview(mesclarAnalises(analises));
    } catch (err) {
      setError(err.message || 'Não foi possível ler os arquivos.');
      resetPreview();
    } finally {
      setBusy(false);
    }
  }

  function toggleItem(secKey, idx) {
    setSelected((prev) => ({
      ...prev,
      [secKey]: {
        ...(prev[secKey] || {}),
        [idx]: !prev[secKey]?.[idx],
      },
    }));
  }

  function toggleSecao(secKey, on) {
    const sec = preview?.secoes?.find((s) => s.key === secKey);
    if (!sec) return;
    setSelected((prev) => ({
      ...prev,
      [secKey]: Object.fromEntries(sec.items.map((_, idx) => [idx, on])),
    }));
  }

  function confirmar() {
    if (!preview) return;
    const patch = {};
    let aplicados = 0;
    for (const sec of preview.secoes) {
      const picks = (sec.items || []).filter((_, idx) => selected[sec.key]?.[idx]);
      if (!picks.length) continue;
      patch[sec.key] = mesclarTextoCampo(values?.[sec.key], picks, modo);
      aplicados += picks.length;
    }
    if (!aplicados) {
      setError('Marque ao menos um item para aplicar.');
      return;
    }
    onApply?.(patch);
    onMessage?.(
      modo === 'acrescentar'
        ? `${aplicados} item(ns) acrescentados nos campos de texto.`
        : `${aplicados} item(ns) aplicados nos campos de texto.`,
    );
    resetPreview();
    setFiles([]);
  }

  const secoesComItens = preview?.secoes?.filter((s) => s.count > 0) || [];

  return (
    <div className="import-catalogo">
      <div className="import-catalogo-head">
        <div>
          <strong>Ou importe de arquivo</strong>
          <p className="hint" style={{ margin: '4px 0 0' }}>
            Opcional. Envie um ou vários .txt / .csv / .tsv / .md. Depois de confirmar,
            os itens entram nos campos de texto abaixo (você ainda pode editar à mão).
          </p>
        </div>
        <div className="row">
          <Btn
            type="button"
            variant="ghost"
            icon="file"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Escolher arquivos
          </Btn>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".txt,.csv,.tsv,.md,.log,text/plain,text/csv"
            hidden
            onChange={onPickFiles}
          />
        </div>
      </div>

      {files.length ? (
        <ul className="import-catalogo-files">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${index}`}>
              <Icon name="file" size={16} />
              <span>{file.name}</span>
              <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
              <button type="button" className="linkish" onClick={() => removerArquivo(index)}>
                Remover
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint import-catalogo-drop">Nenhum arquivo selecionado ainda.</p>
      )}

      <div className="row">
        <Btn
          type="button"
          icon="search"
          disabled={busy || !files.length}
          onClick={analisarArquivos}
        >
          {busy ? 'Analisando…' : 'Analisar arquivos'}
        </Btn>
      </div>

      <Alert error={error} />

      <Modal
        open={Boolean(preview)}
        title="Confirmar importação"
        onClose={resetPreview}
        className="modal-sheet--catalog"
        footer={(
          <>
            <Btn variant="ghost" onClick={resetPreview}>Cancelar</Btn>
            <Btn icon="check" onClick={confirmar}>Confirmar e preencher campos</Btn>
          </>
        )}
      >
        {preview ? (
          <div className="import-catalogo-preview">
            <p className="hint" style={{ marginTop: 0 }}>
              Origem: <strong>{preview.origem}</strong>
              {' · '}
              {preview.total} item(ns) identificados.
              Revise, desmarque o que não quiser e confirme.
            </p>
            {(preview.avisos || []).length ? (
              <ul className="import-catalogo-avisos">
                {preview.avisos.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            ) : null}

            <div className="import-catalogo-modo">
              <label className={modo === 'acrescentar' ? 'is-on' : ''}>
                <input
                  type="radio"
                  name="import-modo"
                  checked={modo === 'acrescentar'}
                  onChange={() => setModo('acrescentar')}
                />
                <span>Acrescentar ao texto que já está nos campos</span>
              </label>
              <label className={modo === 'substituir' ? 'is-on' : ''}>
                <input
                  type="radio"
                  name="import-modo"
                  checked={modo === 'substituir'}
                  onChange={() => setModo('substituir')}
                />
                <span>Substituir o conteúdo atual dos campos</span>
              </label>
            </div>

            {secoesComItens.map((sec) => {
              const marked = sec.items.filter((_, idx) => selected[sec.key]?.[idx]).length;
              return (
                <section key={sec.key} className="import-catalogo-sec">
                  <header>
                    <h3>
                      <Icon
                        name={sec.key.includes('fornecedor') ? 'box' : sec.key.includes('local') ? 'map' : 'layers'}
                        size={16}
                      />
                      {sec.label}
                      <small>{marked}/{sec.count}</small>
                    </h3>
                    <div className="row">
                      <button type="button" className="linkish" onClick={() => toggleSecao(sec.key, true)}>Todos</button>
                      <button type="button" className="linkish" onClick={() => toggleSecao(sec.key, false)}>Nenhum</button>
                    </div>
                  </header>
                  <ul>
                    {sec.items.map((line, idx) => (
                      <li key={`${sec.key}-${idx}`}>
                        <label className={selected[sec.key]?.[idx] ? 'is-on' : ''}>
                          <input
                            type="checkbox"
                            checked={Boolean(selected[sec.key]?.[idx])}
                            onChange={() => toggleItem(sec.key, idx)}
                          />
                          <span>{line}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
