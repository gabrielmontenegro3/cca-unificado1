import { arquivoEhImagem } from '../lib/api';
import { Icon } from './icons';

const OFFICE_EXT = /\.(docx?|xlsx?|pptx?)$/i;

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

/** Abre o arquivo em outra aba do navegador (sem janela dentro do sistema). */
export function abrirEmNovaAba(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Botão pequeno com nome do arquivo; abre o arquivo em outra aba. */
export function ArquivoChip({ arquivo, url }) {
  const tipo = tipoArquivo(arquivo);
  const icone = tipo === 'imagem' ? 'eye' : 'file';
  return (
    <button
      type="button"
      className={`arquivo-chip arquivo-chip--${tipo}`}
      onClick={() => abrirEmNovaAba(url)}
      disabled={!url}
      title={`Abrir ${nomeDe(arquivo)} em outra aba`}
    >
      <Icon name={icone} size={14} />
      <span>{nomeDe(arquivo)}</span>
    </button>
  );
}

/** Cartão de prévia: mostra o arquivo resumido; clicar abre o arquivo em outra aba. */
export function ArquivoPreviewCard({ arquivo, url, actions = null, compact = false }) {
  const tipo = tipoArquivo(arquivo);
  const nome = nomeDe(arquivo);
  const ext = tipo === 'pdf' ? 'PDF' : extensaoDe(arquivo);
  const tamanho = formatarTamanho(arquivo?.tamanho_bytes);
  const meta = [rotuloTipo(tipo, arquivo), tamanho].filter(Boolean).join(' · ');

  return (
    <article className={['arquivo-preview', `arquivo-preview--${tipo}`, compact ? 'arquivo-preview--compact' : ''].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="arquivo-preview-thumb"
        onClick={() => abrirEmNovaAba(url)}
        disabled={!url}
        aria-label={`Abrir ${nome} em outra aba`}
        title="Abrir em outra aba"
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
          <Icon name="link" size={20} />
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
          onClick={() => abrirEmNovaAba(url)}
          disabled={!url}
          title="Abrir em outra aba"
        >
          <Icon name="link" size={16} />
          Abrir
        </button>
        {actions}
      </div>
    </article>
  );
}
