import { useEffect, useMemo, useState } from 'react';
import { arquivoEhImagem, nomeArquivoDaMensagem, publicOrSignedUrl } from '../lib/api';
import { formatChatTime, formatDate, nomePessoa } from '../lib/format';
import { CRITICIDADE_LABEL, STATUS_LABEL } from '../lib/permissions';
import { horarioDoEvento, montarLinhaDoTempoChat } from '../lib/chamadoRastreabilidade';
import { mensagemEhNova } from '../lib/notifications';
import { Empty, UserAvatar } from './ui';
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

export function LaudoThumb({ capa }) {
  if (capa?.url && arquivoEhImagem(capa)) {
    return <img className="laudo-item-thumb" src={capa.url} alt="" />;
  }
  return (
    <span className="laudo-item-thumb laudo-item-thumb--file" aria-hidden="true">
      <Icon name="file" size={18} />
    </span>
  );
}

export function CriticidadeTag({ value }) {
  const grau = String(value || 'media').toLowerCase();
  return (
    <span className={`laudo-crit laudo-crit--${grau}`}>
      {CRITICIDADE_LABEL[grau] || 'Média'}
    </span>
  );
}

function textoEhRotuloArquivo(texto) {
  const raw = String(texto || '').trim();
  if (!raw) return true;
  return /^imagem$/i.test(raw) || Boolean(nomeArquivoDaMensagem(raw));
}

function separarAberturaLaudo(mensagens) {
  const list = mensagens || [];
  const abertura = list.filter((m) => m.abertura);
  if (abertura.length) {
    return { abertura, notas: list.filter((m) => !m.abertura) };
  }
  const primeira = list.find((m) => (m.anexos || []).length);
  if (!primeira) return { abertura: [], notas: list };
  return { abertura: [primeira], notas: list.filter((m) => m.id !== primeira.id) };
}

export function LaudoDocumentoCard({ mensagem }) {
  const anexos = mensagem?.anexos || [];
  const anexoKey = anexos.map((a) => a.id || a.storage_path || a.nome_original).join('|');
  const [items, setItems] = useState(anexos);
  const texto = String(mensagem?.texto || '').trim();
  const descricao = textoEhRotuloArquivo(texto) ? '' : texto;
  const autor = nomePessoa(mensagem?.usuarios) || 'Gestão Técnica';
  const quando = mensagem?.created_at ? formatDate(mensagem.created_at) : '';

  useEffect(() => {
    let live = true;
    const list = mensagem?.anexos || [];
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
    return () => { live = false; };
  }, [anexoKey, mensagem]);

  if (!items.length && !descricao) return null;

  return (
    <article className="laudo-doc">
      <header className="laudo-doc-head">
        <span className="laudo-doc-kicker">Documento do laudo</span>
        <small>{[autor, quando].filter(Boolean).join(' · ')}</small>
      </header>
      {descricao ? <p className="laudo-doc-text">{descricao}</p> : null}
      {items.length ? (
        <div className={`laudo-doc-files${items.length > 1 ? ' laudo-doc-files--grid' : ''}`}>
          {items.map((arquivo) => {
            const key = arquivo.id || arquivo.storage_path || arquivo.nome_original;
            const nome = arquivo.nome_original || arquivo.nome_arquivo || 'Arquivo';
            if ((arquivo.isImage || arquivoEhImagem(arquivo)) && arquivo.url) {
              return (
                <a key={key} className="laudo-doc-shot" href={arquivo.url} target="_blank" rel="noreferrer">
                  <img src={arquivo.url} alt={nome} />
                  <span>{nome}</span>
                </a>
              );
            }
            if (arquivo.url) {
              return (
                <a key={key} className="laudo-file-card" href={arquivo.url} target="_blank" rel="noreferrer">
                  <span className="laudo-file-icon" aria-hidden="true">
                    <Icon name="file" size={22} />
                  </span>
                  <span className="laudo-file-copy">
                    <strong>{nome}</strong>
                    <small>Abrir documento</small>
                  </span>
                </a>
              );
            }
            return (
              <div key={key} className="laudo-file-card laudo-file-card--pending">
                <span className="laudo-file-icon" aria-hidden="true">
                  <Icon name="file" size={22} />
                </span>
                <span className="laudo-file-copy">
                  <strong>{nome}</strong>
                  <small>Carregando arquivo…</small>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

export function LaudoThread({
  mensagens,
  sessionUserId,
  lidaAte,
  bloquearDocumento = false,
  empty = 'Nenhuma nota ainda.',
}) {
  const { abertura, notas } = useMemo(() => separarAberturaLaudo(mensagens), [mensagens]);
  if (!abertura.length && !notas.length) return <Empty text={empty} />;
  return (
    <div className="laudo-thread">
      {bloquearDocumento ? (
        <article className="laudo-doc laudo-doc--locked">
          <header className="laudo-doc-head">
            <span className="laudo-doc-kicker">Documento do laudo</span>
          </header>
          <p className="laudo-doc-text">
            Aceite o termo de recebimento à esquerda para visualizar ou baixar este documento.
          </p>
        </article>
      ) : abertura.map((m) => <LaudoDocumentoCard key={m.id} mensagem={m} />)}
      {notas.length ? (
        <section className="laudo-notas laudo-notas--chat" aria-label="Conversa">
          {notas.map((m) => (
            <ChatMensagem
              key={m.id}
              mensagem={m}
              mine={m.usuario_id === sessionUserId}
              isNew={mensagemEhNova(m, sessionUserId, lidaAte)}
              quando={formatChatTime(m.created_at)}
              comFoto
              omitirAnexos={bloquearDocumento}
            />
          ))}
        </section>
      ) : (
        <p className="laudo-notas-empty">A conversa do laudo aparece aqui.</p>
      )}
    </div>
  );
}

export function ChatMensagem({
  mensagem,
  mine,
  quando,
  isNew = false,
  solicitanteId,
  solicitanteNome,
  origemAdmin = false,
  comFoto = false,
  omitirAnexos = false,
}) {
  const anexos = omitirAnexos ? [] : (mensagem.anexos || []);
  const texto = String(mensagem.texto || '').trim();
  const nome = nomeArquivoDaMensagem(texto);
  const ehArquivo = Boolean(nome) || /^imagem$/i.test(texto);
  const temImagem = anexos.some((a) => a.isImage || arquivoEhImagem(a) || arquivoEhImagem({ nome_original: nome }));
  const mostrarTexto = texto && !(ehArquivo && (anexos.length || temImagem));
  const destaque = Boolean(mensagem.abertura);
  const autorNome = nomePessoa(mensagem.usuarios);
  const ehSolicitante = Boolean(solicitanteId && mensagem.usuario_id === solicitanteId);
  const autor = ehSolicitante
    ? (autorNome || nomePessoa(solicitanteNome) || (origemAdmin ? 'Administração' : 'Morador'))
    : (autorNome || 'Equipe');
  const foto = mensagem.usuarios?.foto_url;
  const verified = Boolean(mensagem.usuarios?.gestao_tecnica);
  const mostrarAvatar = comFoto || Boolean(foto);
  const avatar = mostrarAvatar ? (
    <UserAvatar src={foto} nome={mine ? 'Você' : autor} verified={verified} size={32} />
  ) : (!mine ? <span className="msg-avatar">{iniciais(autor)}</span> : null);
  return (
    <div className={`msg-row ${mine ? 'mine' : ''}${isNew ? ' is-new' : ''}${destaque ? ' msg-row--abertura' : ''}`}>
      {!mine ? avatar : null}
      <article className={`msg ${mine ? 'mine' : ''}${isNew ? ' is-new' : ''}${destaque ? ' msg--abertura' : ''}`}>
        {!mine ? <small className="msg-name">{autor}</small> : null}
        {destaque ? <small className="msg-abertura-label">Foto do chamado</small> : null}
        {mostrarTexto ? <div className="msg-text">{mensagem.texto}</div> : null}
        <ChatAnexos anexos={anexos} />
        <time>{quando}</time>
      </article>
      {mine && mostrarAvatar ? avatar : null}
    </div>
  );
}

export function ChatEvento({ item }) {
  if (item?.kind === 'visita') {
    const visita = item.visita;
    const hora = horarioDoEvento(visita);
    const dia = visita?.data_ocorrencia || visita?.created_at || item.at;
    return (
      <div className="chat-event chat-event--visita" role="status">
        <span className="chat-event-icon" aria-hidden="true">
          <Icon name="calendar" size={20} />
        </span>
        <div className="chat-event-copy">
          <strong>Visita agendada</strong>
          <span>
            {formatDate(dia)}
            {hora ? ` às ${hora}` : ''}
          </span>
        </div>
        <time>{formatChatTime(item.at)}</time>
      </div>
    );
  }

  if (item?.kind === 'status') {
    const de = STATUS_LABEL[item.de] || item.de;
    const para = STATUS_LABEL[item.para] || item.para;
    const detalhe = de && para && de !== para ? `${de} → ${para}` : (para || de || 'Atualizado');
    return (
      <div className="chat-event chat-event--status" role="status">
        <span className="chat-event-icon" aria-hidden="true">
          <Icon name="check" size={20} />
        </span>
        <div className="chat-event-copy">
          <strong>Status atualizado</strong>
          <span>{detalhe}</span>
        </div>
        <time>{formatChatTime(item.at)}</time>
      </div>
    );
  }

  return null;
}

export function ChatLog({
  mensagens,
  historico,
  visitas,
  sessionUserId,
  lidaAte,
  solicitanteId,
  solicitanteNome,
  origemAdmin = false,
  empty = 'Envie a primeira mensagem.',
}) {
  const items = useMemo(
    () => montarLinhaDoTempoChat({ mensagens, historico, visitas }),
    [mensagens, historico, visitas],
  );
  if (!items.length) return <Empty text={empty} />;
  return (
    <>
      {items.map((item) => {
        if (item.kind !== 'msg') return <ChatEvento key={item.id} item={item} />;
        const m = item.mensagem;
        return (
          <ChatMensagem
            key={item.id}
            mensagem={m}
            mine={m.usuario_id === sessionUserId}
            isNew={mensagemEhNova(m, sessionUserId, lidaAte)}
            quando={formatChatTime(m.created_at)}
            solicitanteId={solicitanteId}
            solicitanteNome={solicitanteNome}
            origemAdmin={origemAdmin}
          />
        );
      })}
    </>
  );
}

export function ChatHeader({ title, subtitle, children, onClick, icon = 'message' }) {
  const clickable = typeof onClick === 'function';
  return (
    <header className={`chat-head${clickable ? ' chat-head--clickable' : ''}`}>
      <button
        type="button"
        className="chat-head-main"
        onClick={clickable ? onClick : undefined}
        disabled={!clickable}
        title={clickable ? 'Ver dados do solicitante' : undefined}
      >
        <span className="chat-head-icon" aria-hidden="true">
          <Icon name={icon} />
        </span>
        <div className="chat-head-copy">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </div>
      </button>
      {children ? <div className="chat-head-extra">{children}</div> : null}
    </header>
  );
}

export function ChatComposer({ value, onChange, onSend, onFile, sending, placeholder = 'Escreva uma mensagem' }) {
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
        placeholder={placeholder}
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
