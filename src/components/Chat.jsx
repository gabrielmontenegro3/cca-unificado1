import { useEffect, useState } from 'react';
import { arquivoEhImagem, nomeArquivoDaMensagem, publicOrSignedUrl } from '../lib/api';
import { Icon } from './icons';

function iniciais(nome) {
  const parts = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '•';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function ChatAnexos({ anexos }) {
  const [items, setItems] = useState(anexos || []);

  useEffect(() => {
    let live = true;
    const list = anexos || [];
    setItems(list);
    (async () => {
      const next = await Promise.all(list.map(async (arquivo) => {
        if (arquivo.url) return { ...arquivo, isImage: arquivo.isImage || arquivoEhImagem(arquivo) };
        if (!arquivo.storage_path) return { ...arquivo, isImage: arquivoEhImagem(arquivo) };
        const { data } = await publicOrSignedUrl(arquivo.storage_path);
        return {
          ...arquivo,
          url: data?.signedUrl || null,
          isImage: arquivoEhImagem(arquivo),
        };
      }));
      if (live) setItems(next);
    })();
    return () => {
      live = false;
    };
  }, [anexos]);

  if (!items.length) return null;
  return (
    <div className="chat-anexos">
      {items.map((arquivo) => {
        const key = arquivo.id || arquivo.storage_path || arquivo.nome_original;
        if ((arquivo.isImage || arquivoEhImagem(arquivo)) && arquivo.url) {
          return (
            <a key={key} href={arquivo.url} target="_blank" rel="noreferrer">
              <img className="chat-img" src={arquivo.url} alt={arquivo.nome_original || 'Imagem'} />
            </a>
          );
        }
        if (arquivo.url) {
          return (
            <a key={key} className="chat-file" href={arquivo.url} target="_blank" rel="noreferrer">
              <Icon name="file" size={16} />
              {arquivo.nome_original || 'Abrir arquivo'}
            </a>
          );
        }
        return null;
      })}
    </div>
  );
}

export function ChatMensagem({ mensagem, mine, quando }) {
  const anexos = mensagem.anexos || [];
  const texto = String(mensagem.texto || '').trim();
  const nome = nomeArquivoDaMensagem(texto);
  const ehArquivo = Boolean(nome) || /^imagem$/i.test(texto);
  const temImagem = anexos.some((a) => a.isImage || arquivoEhImagem(a) || arquivoEhImagem({ nome_original: nome }));
  const mostrarTexto = texto && !(ehArquivo && (anexos.length || temImagem));
  const autor = mensagem.usuarios?.nome || 'Equipe';
  return (
    <div className={`msg-row ${mine ? 'mine' : ''}`}>
      {!mine ? <span className="msg-avatar">{iniciais(autor)}</span> : null}
      <article className={`msg ${mine ? 'mine' : ''}`}>
        {!mine ? <small className="msg-name">{autor}</small> : null}
        {mostrarTexto ? <div className="msg-text">{mensagem.texto}</div> : null}
        <ChatAnexos anexos={anexos} />
        <time>{quando}</time>
      </article>
    </div>
  );
}

export function ChatHeader({ title, subtitle, children }) {
  return (
    <header className="chat-head">
      <div className="chat-head-main">
        <span className="chat-head-icon" aria-hidden="true">
          <Icon name="message" />
        </span>
        <div className="chat-head-copy">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </div>
      </div>
      {children ? <div className="chat-head-extra">{children}</div> : null}
    </header>
  );
}

export function ChatComposer({ value, onChange, onSend, onFile, sending }) {
  return (
    <form className="chat-composer" onSubmit={onSend}>
      <label className="chat-icon-btn" title="Anexar arquivo">
        <input
          type="file"
          accept="image/*,.pdf"
          capture="environment"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
        <Icon name="paperclip" />
      </label>
      <input
        className="chat-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Escreva uma mensagem"
        disabled={sending}
        autoComplete="off"
      />
      <button
        className="chat-send"
        type="submit"
        disabled={sending || !String(value || '').trim()}
        title="Enviar"
      >
        <Icon name="send" />
      </button>
    </form>
  );
}
