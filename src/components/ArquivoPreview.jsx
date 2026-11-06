import { useEffect, useRef, useState } from 'react';
import { arquivoEhImagem } from '../lib/api';
import { Modal } from './DataList';
import { Icon } from './icons';

const OFFICE_EXT = /\.(docx?|xlsx?|pptx?)$/i;
const MOBILE_QUERY = '(max-width: 760px), (pointer: coarse)';

function nomeDe(arquivo) {
  return String(arquivo?.nome_original || arquivo?.nome_arquivo || 'Arquivo');
}

function extensaoDe(arquivo) {
  const match = nomeDe(arquivo).match(/\.([a-z0-9]{1,5})$/i);
  return match ? match[1].toUpperCase() : '';
}

export function tipoArquivo(arquivo) {
  const mime = String(arquivo?.mime_type || '').toLowerCase();
  const nome = nomeDe(arquivo).toLowerCase();
  if (mime === 'application/pdf' || nome.endsWith('.pdf')) return 'pdf';
  if (arquivoEhImagem(arquivo)) return 'imagem';
  if (OFFICE_EXT.test(nome)) return 'office';
  return 'outro';
}

function rotuloTipo(tipo, arquivo) {
  if (tipo === 'pdf') return 'Documento PDF';
  if (tipo === 'imagem') return 'Imagem';
  const ext = extensaoDe(arquivo);
  return ext ? `Arquivo ${ext}` : 'Arquivo';
}

export function formatarTamanho(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function useEhMobile() {
  const [mobile, setMobile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia?.(MOBILE_QUERY).matches
  ));
  useEffect(() => {
    const mq = window.matchMedia?.(MOBILE_QUERY);
    if (!mq) return undefined;
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return mobile;
}

let pdfjsPromise = null;
function carregarPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * PDF desenhado página por página (pdf.js). Usado no celular, onde o PDF
 * dentro de iframe não rola nem aparece direito.
 */
function PdfPaginas({ url, nome }) {
  const hostRef = useRef(null);
  const [status, setStatus] = useState('carregando');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelado = false;
    let doc = null;
    const host = hostRef.current;
    if (!host) return undefined;
    host.innerHTML = '';
    setStatus('carregando');

    (async () => {
      try {
        const pdfjs = await carregarPdfjs();
        doc = await pdfjs.getDocument({ url }).promise;
        if (cancelado) return;
        const larguraCss = Math.max(280, host.clientWidth || window.innerWidth);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= doc.numPages; n += 1) {
          if (cancelado) return;
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const alvo = Math.min(larguraCss * dpr * 1.5, 2000);
          const viewport = page.getViewport({ scale: alvo / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'arquivo-pdf-pagina';
          canvas.setAttribute('aria-label', `${nome} — página ${n} de ${doc.numPages}`);
          host.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          if (n === 1 && !cancelado) setStatus('ok');
        }
      } catch {
        if (!cancelado) setStatus('erro');
      }
    })();

    return () => {
      cancelado = true;
      doc?.destroy?.();
    };
  }, [url, nome]);

  return (
    <div className="arquivo-pdf">
      {status === 'carregando' ? <p className="arquivo-pdf-status">Carregando documento…</p> : null}
      {status === 'erro' ? (
        <p className="arquivo-pdf-status">Não foi possível mostrar o PDF aqui. Use “Abrir em nova aba”.</p>
      ) : null}
      <div className="arquivo-pdf-scroll">
        <div ref={hostRef} className="arquivo-pdf-paginas" style={{ width: `${zoom * 100}%` }} />
      </div>
      {status === 'ok' ? (
        <div className="arquivo-pdf-zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))} disabled={zoom <= 1} aria-label="Diminuir zoom">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(3, +(z + 0.5).toFixed(1)))} disabled={zoom >= 3} aria-label="Aumentar zoom">+</button>
        </div>
      ) : null}
    </div>
  );
}

/** Visualizador em modal: mostra o arquivo dentro do sistema, sem baixar. No celular ocupa a tela toda. */
export function ArquivoViewer({ arquivo, url, onClose }) {
  const mobile = useEhMobile();
  const tipo = tipoArquivo(arquivo);
  const nome = nomeDe(arquivo);
  return (
    <Modal
      open={Boolean(arquivo && url)}
      title={nome}
      className="modal-sheet--wide arquivo-viewer-sheet"
      backdropClassName="arquivo-viewer-backdrop"
      onClose={onClose}
      footer={(
        <a className="arquivo-viewer-nova-aba" href={url} target="_blank" rel="noreferrer">
          <Icon name="link" size={15} />
          Abrir em nova aba
        </a>
      )}
    >
      <div className={`arquivo-viewer arquivo-viewer--${tipo}`}>
        {tipo === 'pdf' && mobile ? <PdfPaginas url={url} nome={nome} /> : null}
        {tipo === 'pdf' && !mobile ? (
          <iframe className="arquivo-viewer-frame" title={nome} src={`${url}#toolbar=1&view=FitH`} />
        ) : null}
        {tipo === 'imagem' ? (
          <img className="arquivo-viewer-imagem" src={url} alt={nome} />
        ) : null}
        {tipo === 'office' ? (
          <iframe
            className="arquivo-viewer-frame"
            title={nome}
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
          />
        ) : null}
        {tipo === 'outro' ? (
          <div className="arquivo-viewer-vazio">
            <Icon name="file" size={34} />
            <p>Este tipo de arquivo não tem visualização no navegador.</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** Botão pequeno com nome do arquivo que abre o visualizador. */
export function ArquivoChip({ arquivo, url }) {
  const [aberto, setAberto] = useState(false);
  const tipo = tipoArquivo(arquivo);
  const icone = tipo === 'imagem' ? 'eye' : 'file';
  return (
    <>
      <button
        type="button"
        className={`arquivo-chip arquivo-chip--${tipo}`}
        onClick={() => setAberto(true)}
        disabled={!url}
        title={`Visualizar ${nomeDe(arquivo)}`}
      >
        <Icon name={icone} size={14} />
        <span>{nomeDe(arquivo)}</span>
      </button>
      {aberto ? <ArquivoViewer arquivo={arquivo} url={url} onClose={() => setAberto(false)} /> : null}
    </>
  );
}

/** Cartão de prévia: mostra o arquivo resumido, centralizado, com botão para visualizar. */
export function ArquivoPreviewCard({ arquivo, url, actions = null, compact = false }) {
  const [aberto, setAberto] = useState(false);
  const tipo = tipoArquivo(arquivo);
  const nome = nomeDe(arquivo);
  const ext = tipo === 'pdf' ? 'PDF' : extensaoDe(arquivo);
  const tamanho = formatarTamanho(arquivo?.tamanho_bytes);
  const meta = [rotuloTipo(tipo, arquivo), tamanho].filter(Boolean).join(' · ');

  return (
    <>
    <article className={['arquivo-preview', `arquivo-preview--${tipo}`, compact ? 'arquivo-preview--compact' : ''].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="arquivo-preview-thumb"
        onClick={() => setAberto(true)}
        disabled={!url}
        aria-label={`Visualizar ${nome}`}
      >
        {tipo === 'imagem' && url ? (
          <img src={url} alt="" loading="lazy" />
        ) : (
          <span className="arquivo-preview-doc" aria-hidden="true">
            <span className="arquivo-preview-doc-fold" />
            <span className="arquivo-preview-doc-lines">
              <i /><i /><i /><i />
            </span>
            {ext ? <span className="arquivo-preview-badge">{ext}</span> : null}
          </span>
        )}
        <span className="arquivo-preview-hover" aria-hidden="true">
          <Icon name="eye" size={20} />
        </span>
      </button>
      <div className="arquivo-preview-info">
        <strong title={nome}>{nome}</strong>
        {meta ? <span>{meta}</span> : null}
      </div>
      <div className="arquivo-preview-actions">
        <button
          type="button"
          className="arquivo-preview-btn"
          onClick={() => setAberto(true)}
          disabled={!url}
        >
          <Icon name="eye" size={16} />
          Visualizar
        </button>
        {actions}
      </div>
    </article>
    {aberto ? <ArquivoViewer arquivo={arquivo} url={url} onClose={() => setAberto(false)} /> : null}
    </>
  );
}
