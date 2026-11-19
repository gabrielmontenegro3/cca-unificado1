import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { ehCargoConstrutora } from '../lib/permissions';
import { formatChatTime, formatDate } from '../lib/format';
import {
  STATUS_CHAT,
  TIPOS_RECEBIMENTO,
  agendarVistoriaUnidade,
  carregarChatUnidade,
  contarMoradoresUnidade,
  criarAreas,
  criarUnidades,
  desmarcarUnidadeOk,
  editarArea,
  editarUnidade,
  enviarMensagemUnidade,
  excluirArea,
  excluirUnidade,
  listarChatsAreas,
  listarChatsUnidades,
  marcarUnidadeOk,
  mensagemErroAreas,
  mensagemErroRecebimentoChat,
  mensagemErroUnidade,
  nomesDosLocais,
  salvarOrdemAreas,
  salvarOrdemUnidades,
  unidadesDoMorador,
} from '../lib/recebimento';
import { useArrastarOrdenar } from '../lib/useArrastarOrdenar';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';
import { EditTelaButton } from '../components/EditTela';
import { Modal } from '../components/DataList';
import { Icon } from '../components/icons';
import { ChatComposer, ChatHeader, ChatMensagem } from '../components/Chat';
import { abrirArquivo, arquivoAbreNoNavegador, formatarTamanho } from '../components/ArquivoPreview';
import { arquivoEhImagem } from '../lib/api';

/* ---------- Peças ---------- */

/** Selo da unidade: nada (sem vistoria), azul (com chat) ou verde com ✓ (OK). */
export function SeloRecebimento({ status }) {
  if (status === 'ok') {
    return (
      <span className="rec-selo is-ok" title="Entrega OK">
        <Icon name="check" size={13} />
        OK
      </span>
    );
  }
  if (status === 'chat') return <span className="rec-selo is-chat">Em andamento</span>;
  return <span className="rec-selo">Sem vistoria</span>;
}

function horaDe(valor) {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function extensaoAnexo(arquivo) {
  const m = String(arquivo?.nome_original || arquivo?.storage_path || '').match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toUpperCase() : '';
}

/** Cor do ícone pelo tipo: PDF vermelho, Word azul, Excel verde, PowerPoint laranja. */
function corAnexo(ext) {
  if (ext === 'PDF') return 'pdf';
  if (/^DOCX?$|^ODT$|^RTF$/.test(ext)) return 'word';
  if (/^XLSX?$|^ODS$|^CSV$/.test(ext)) return 'excel';
  if (/^PPTX?$|^ODP$/.test(ext)) return 'ppt';
  if (/^(DWG|DXF|RVT|IFC|SKP)$/.test(ext)) return 'cad';
  return 'outro';
}

function rotuloAnexo(ext) {
  const cor = corAnexo(ext);
  if (cor === 'pdf') return 'Documento PDF';
  if (cor === 'word') return 'Documento Word';
  if (cor === 'excel') return 'Planilha';
  if (cor === 'ppt') return 'Apresentação';
  if (cor === 'cad') return 'Projeto';
  return ext ? `Arquivo ${ext}` : 'Arquivo';
}

/** Anexos da vistoria: fotos em miniatura e documentos em cartões; clicar abre em outra aba. */
export function AnexosVistoria({ anexos }) {
  const lista = anexos || [];
  if (!lista.length) return null;
  const fotos = lista.filter((a) => arquivoEhImagem(a) && a.url);
  const documentos = lista.filter((a) => !fotos.includes(a));
  return (
    <div className="rec-anexos-card">
      {fotos.length ? (
        <div className="rec-anexos-fotos">
          {fotos.map((foto) => (
            <button
              type="button"
              key={foto.id || foto.storage_path}
              className="rec-anexo-foto"
              onClick={() => abrirArquivo(foto, foto.url)}
              title={`Abrir ${foto.nome_original || 'imagem'}`}
            >
              <img src={foto.url} alt={foto.nome_original || 'Imagem anexada'} loading="lazy" />
              <span className="rec-anexo-foto-zoom" aria-hidden="true"><Icon name="eye" size={18} /></span>
            </button>
          ))}
        </div>
      ) : null}
      {documentos.map((doc) => {
        const ext = extensaoAnexo(doc);
        const abre = arquivoAbreNoNavegador(doc);
        const meta = [rotuloAnexo(ext), formatarTamanho(doc.tamanho_bytes)].filter(Boolean).join(' · ');
        return (
          <button
            type="button"
            key={doc.id || doc.storage_path}
            className={`rec-doc rec-doc--${corAnexo(ext)}`}
            onClick={() => abrirArquivo(doc, doc.url)}
            disabled={!doc.url}
            title={abre ? 'Abrir em outra aba' : 'O navegador não mostra este tipo de arquivo: ele será baixado'}
          >
            <span className="rec-doc-icone" aria-hidden="true">
              <Icon name="file" size={22} />
              {ext ? <b>{ext}</b> : null}
            </span>
            <span className="rec-doc-info">
              <strong>{doc.nome_original || 'Documento'}</strong>
              {meta ? <small>{meta}</small> : null}
            </span>
            <span className="rec-doc-acao">
              <Icon name={abre ? 'eye' : 'download'} size={15} />
              {abre ? 'Abrir' : 'Baixar'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Eventos dentro do chat: vistoria agendada, OK da entrega e registros antigos. */
function EventoChat({ registro }) {
  if (registro.tipo === 'vistoria_agendada') {
    const hora = horaDe(registro.data_evento);
    return (
      <div className="chat-event chat-event--visita rec-evento-vistoria" role="status">
        <span className="chat-event-icon" aria-hidden="true"><Icon name="calendar" size={20} /></span>
        <div className="chat-event-copy">
          <strong>{registro.titulo || 'Vistoria agendada'}</strong>
          <span>Vistoria em {formatDate(registro.data_evento)}{hora ? ` às ${hora}` : ''}</span>
          {registro.descricao ? <p className="rec-evento-descricao">{registro.descricao}</p> : null}
          <AnexosVistoria anexos={registro.arquivos} />
        </div>
        <time>{formatChatTime(registro.created_at || registro.data_evento)}</time>
      </div>
    );
  }
  if (registro.tipo === 'assinatura_entrega') {
    return (
      <div className="chat-event rec-evento-ok" role="status">
        <span className="rec-evento-ok-selo" aria-hidden="true"><Icon name="check" size={18} /></span>
        <div className="chat-event-copy">
          <strong>Entrega OK</strong>
          <span>{registro.area_id ? 'Área entregue' : 'Imóvel entregue'} sem pendências{registro.autorNome ? ` · ${registro.autorNome}` : ''}</span>
        </div>
        <time>{formatChatTime(registro.data_evento)}</time>
      </div>
    );
  }
  const meta = TIPOS_RECEBIMENTO[registro.tipo];
  return (
    <div className="chat-event rec-evento-antigo" role="status">
      <span className="chat-event-icon" aria-hidden="true"><Icon name={meta?.icon || 'clipboard'} size={18} /></span>
      <div className="chat-event-copy">
        <strong>{registro.titulo || meta?.label || 'Registro'}</strong>
        {registro.descricao ? <span>{registro.descricao}</span> : null}
      </div>
      <time>{formatChatTime(registro.data_evento)}</time>
    </div>
  );
}

function agoraLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function AgendarVistoriaModal({ open, unidade, busy, onClose, onSalvar }) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [quando, setQuando] = useState('');
  const [arquivos, setArquivos] = useState([]);
  const [erro, setErro] = useState('');
  const inputArquivoRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTitulo('');
    setDescricao('');
    setQuando(agoraLocal());
    setArquivos([]);
    setErro('');
  }, [open]);

  function adicionarArquivos(lista) {
    const novos = [...(lista || [])];
    if (!novos.length) return;
    // Soma aos já escolhidos, sem repetir o mesmo arquivo.
    setArquivos((atual) => [
      ...atual,
      ...novos.filter((f) => !atual.some((a) => a.name === f.name && a.size === f.size && a.lastModified === f.lastModified)),
    ]);
  }

  function removerArquivo(indice) {
    setArquivos((atual) => atual.filter((_, i) => i !== indice));
  }

  async function salvar(e) {
    e.preventDefault();
    if (!titulo.trim()) return setErro('Escreva o título da vistoria.');
    if (!quando) return setErro('Informe a data da vistoria.');
    await onSalvar({ titulo: titulo.trim(), descricao: descricao.trim(), dataEvento: new Date(quando).toISOString(), files: arquivos });
  }

  return (
    <Modal
      open={open}
      title={`Agendar vistoria${unidade ? ` · ${unidade}` : ''}`}
      className="modal-sheet--trace rec-modal"
      onClose={busy ? undefined : onClose}
      footer={(
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Btn>
          <Btn type="submit" form="rec-agendar" icon="calendar" disabled={busy}>{busy ? 'Salvando…' : 'Agendar'}</Btn>
        </>
      )}
    >
      <form id="rec-agendar" className="stack" onSubmit={salvar}>
        <Alert error={erro} />
        <Field label="Título">
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Vistoria de entrega com o proprietário"
            autoFocus
          />
        </Field>
        <Field label="Data e hora da vistoria">
          <input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} required />
        </Field>
        <Field label="Descrição">
          <textarea
            value={descricao}
            rows={4}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: Levar a chave reserva. Verificar esquadrias e pontos de água."
          />
        </Field>
        <div className="field rec-anexos-campo">
          <span>Anexos (opcional)</span>
          <input
            ref={inputArquivoRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { adicionarArquivos(e.target.files); e.target.value = ''; }}
          />
          <button
            type="button"
            className="rec-anexos-escolher"
            onClick={() => inputArquivoRef.current?.click()}
            disabled={busy}
          >
            <Icon name="paperclip" size={18} />
            Anexar Documento
          </button>
          {arquivos.length ? (
            <ul className="rec-anexos-lista">
              {arquivos.map((f, i) => (
                <li key={`${f.name}-${f.size}-${f.lastModified}`}>
                  <Icon name="file" size={15} />
                  <span className="rec-anexos-nome" title={f.name}>{f.name}</span>
                  <small>{formatarTamanho(f.size)}</small>
                  <button type="button" aria-label={`Remover ${f.name}`} onClick={() => removerArquivo(i)} disabled={busy}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <p className="hint">A vistoria aparece no chat desta unidade, com os anexos, para a construtora e o morador.</p>
      </form>
    </Modal>
  );
}

const VAZIO_UMA = { bloco: '', andar: '', identificacao: '' };
const VAZIO_VARIAS = { bloco: '', de: '1', ate: '', porAndar: '' };

function inteiro(valor) {
  const n = Number.parseInt(String(valor || '').trim(), 10);
  return Number.isFinite(n) ? n : NaN;
}

/** Gera 101…106, 201…206… a partir dos andares e de quantos apartamentos há por andar. */
export function gerarUnidadesPorAndar({ bloco, de, ate, porAndar }) {
  const ini = inteiro(de);
  const fim = inteiro(ate);
  const qtd = inteiro(porAndar);
  if (!(ini >= 1) || !(fim >= ini) || !(qtd >= 1) || fim - ini > 200 || qtd > 99) return [];
  const lista = [];
  for (let andar = ini; andar <= fim; andar += 1) {
    for (let n = 1; n <= qtd; n += 1) {
      lista.push({ bloco, andar: String(andar), identificacao: `${andar}${String(n).padStart(2, '0')}` });
    }
  }
  return lista;
}

/** Gestão Técnica: cadastrar uma unidade, várias de uma vez, ou editar uma unidade. */
function UnidadeModal({ open, unidade, busy, onClose, onCriar, onEditar }) {
  const editando = Boolean(unidade);
  const [aba, setAba] = useState('uma');
  const [uma, setUma] = useState(VAZIO_UMA);
  const [varias, setVarias] = useState(VAZIO_VARIAS);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!open) return;
    setAba('uma');
    setUma(unidade
      ? { bloco: unidade.bloco || '', andar: unidade.andar || '', identificacao: unidade.identificacao || '' }
      : VAZIO_UMA);
    setVarias(VAZIO_VARIAS);
    setErro('');
  }, [open, unidade]);

  const geradas = aba === 'varias' ? gerarUnidadesPorAndar(varias) : [];

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    try {
      if (editando) {
        if (!uma.identificacao.trim()) throw new Error('Informe o número do apartamento.');
        await onEditar(uma);
      } else if (aba === 'uma') {
        if (!uma.identificacao.trim()) throw new Error('Informe o número do apartamento.');
        await onCriar([uma]);
      } else {
        if (!geradas.length) throw new Error('Preencha os andares e quantos apartamentos há por andar.');
        await onCriar(geradas);
      }
    } catch (err) {
      setErro(err.message || 'Não foi possível salvar.');
    }
  }

  const resumoGeradas = geradas.length
    ? `${geradas.length} unidades: ${geradas.slice(0, 3).map((u) => u.identificacao).join(', ')}${geradas.length > 3 ? ` … ${geradas[geradas.length - 1].identificacao}` : ''}`
    : '';

  return (
    <Modal
      open={open}
      title={editando ? `Editar ${unidade?.rotulo || 'unidade'}` : 'Nova unidade'}
      className="modal-sheet--trace rec-modal"
      onClose={busy ? undefined : onClose}
      footer={(
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Btn>
          <Btn type="submit" form="rec-unidade" icon={editando ? 'check' : 'plus'} disabled={busy}>
            {busy ? 'Salvando…' : editando ? 'Salvar' : aba === 'varias' && geradas.length ? `Criar ${geradas.length} unidades` : 'Criar unidade'}
          </Btn>
        </>
      )}
    >
      <form id="rec-unidade" className="stack" onSubmit={salvar}>
        <Alert error={erro} />
        {!editando ? (
          <div className="rec-unidade-abas" role="tablist">
            <button type="button" role="tab" aria-selected={aba === 'uma'} className={aba === 'uma' ? 'is-ativa' : ''} onClick={() => setAba('uma')}>
              Uma unidade
            </button>
            <button type="button" role="tab" aria-selected={aba === 'varias'} className={aba === 'varias' ? 'is-ativa' : ''} onClick={() => setAba('varias')}>
              Várias de uma vez
            </button>
          </div>
        ) : null}

        {editando || aba === 'uma' ? (
          <>
            <Field label="Apartamento (número)">
              <input
                value={uma.identificacao}
                onChange={(e) => setUma({ ...uma, identificacao: e.target.value })}
                placeholder="Ex.: 101"
                autoFocus
                required
              />
            </Field>
            <div className="grid grid-2">
              <Field label="Bloco (opcional)">
                <input value={uma.bloco} onChange={(e) => setUma({ ...uma, bloco: e.target.value })} placeholder="Ex.: A" />
              </Field>
              <Field label="Andar (opcional)">
                <input value={uma.andar} onChange={(e) => setUma({ ...uma, andar: e.target.value })} placeholder="Ex.: 1" />
              </Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Bloco (opcional)">
              <input value={varias.bloco} onChange={(e) => setVarias({ ...varias, bloco: e.target.value })} placeholder="Ex.: A" />
            </Field>
            <div className="grid grid-3 rec-unidade-grade">
              <Field label="Do andar">
                <input type="number" min="1" value={varias.de} onChange={(e) => setVarias({ ...varias, de: e.target.value })} />
              </Field>
              <Field label="Até o andar">
                <input type="number" min="1" value={varias.ate} onChange={(e) => setVarias({ ...varias, ate: e.target.value })} placeholder="Ex.: 12" />
              </Field>
              <Field label="Aptos por andar">
                <input type="number" min="1" max="99" value={varias.porAndar} onChange={(e) => setVarias({ ...varias, porAndar: e.target.value })} placeholder="Ex.: 6" />
              </Field>
            </div>
            <p className={`hint rec-unidade-previa${resumoGeradas ? ' is-ok' : ''}`}>
              {resumoGeradas || 'Ex.: do andar 1 ao 12, com 6 por andar, cria 101 a 106, 201 a 206… até 1206.'}
            </p>
            <p className="hint">Unidades que já existem (mesmo bloco e número) são puladas. Coberturas e outras unidades fora do padrão podem ser criadas uma a uma.</p>
          </>
        )}
      </form>
    </Modal>
  );
}

/* ---------- Tela ---------- */

/** Gestão Técnica: cadastrar ou renomear uma área comum (piscina, salão de festas…). */
function AreaModal({ open, area, busy, condoId, onClose, onCriar, onEditar }) {
  const editando = Boolean(area);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [trazendo, setTrazendo] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNome(area?.nome || '');
    setErro('');
  }, [open, area]);

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    try {
      if (!nome.trim()) throw new Error('Informe o nome da área.');
      if (editando) await onEditar(nome);
      else await onCriar([nome]);
    } catch (err) {
      setErro(err.message || 'Não foi possível salvar.');
    }
  }

  async function trazerLocais() {
    setErro('');
    setTrazendo(true);
    try {
      const nomes = await nomesDosLocais(condoId);
      if (!nomes.length) throw new Error('Nenhum local cadastrado na tela Locais.');
      await onCriar(nomes);
    } catch (err) {
      setErro(err.message || 'Não foi possível trazer os locais.');
    } finally {
      setTrazendo(false);
    }
  }

  return (
    <Modal
      open={open}
      title={editando ? `Editar ${area?.nome || 'área'}` : 'Nova área comum'}
      className="modal-sheet--trace rec-modal"
      onClose={busy ? undefined : onClose}
      footer={(
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Btn>
          <Btn type="submit" form="rec-area" icon={editando ? 'check' : 'plus'} disabled={busy}>
            {busy ? 'Salvando…' : editando ? 'Salvar' : 'Criar área'}
          </Btn>
        </>
      )}
    >
      <form id="rec-area" className="stack" onSubmit={salvar}>
        <Alert error={erro} />
        <Field label="Nome da área">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Piscina, Salão de festas, Hall de entrada"
            autoFocus
            required
          />
        </Field>
        {!editando ? (
          <div className="rec-area-locais">
            <p className="hint">Já cadastrou os locais do condomínio na tela Locais? Traga todos de uma vez (os que já existem aqui são pulados).</p>
            <Btn variant="ghost" icon="map" onClick={trazerLocais} disabled={busy || trazendo}>
              {trazendo ? 'Trazendo…' : 'Trazer os Locais cadastrados'}
            </Btn>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

/** As duas telas de recebimento usam a mesma página; muda só o que é listado e quem vê. */
const MODOS_RECEBIMENTO = {
  privativas: {
    titulo: 'Recebimento das áreas privativas',
    rota: '/recebimento',
    campo: 'unidade_id',
    icone: 'door',
    item: 'unidade',
    itens: 'unidades',
    voltar: 'Unidades',
  },
  comuns: {
    titulo: 'Recebimento das áreas comuns',
    rota: '/recebimento-areas-comuns',
    campo: 'area_id',
    icone: 'building',
    item: 'área',
    itens: 'áreas',
    voltar: 'Áreas comuns',
  },
};

/** Cargos do condomínio que não veem as áreas privativas (síndico e administração). */
function ehEquipeDoCondominio(cargoTipo) {
  return ['administrador', 'administracao'].includes(String(cargoTipo || '').toLowerCase());
}

export function RecebimentoPage({ modo = 'privativas' }) {
  const cfg = MODOS_RECEBIMENTO[modo] || MODOS_RECEBIMENTO.privativas;
  const comuns = modo === 'comuns';
  const { unidadeId } = useParams();
  const navigate = useNavigate();
  const { condoId, session, cargoTipo, isGestaoTecnica, isConstrutoraOrg } = useSession();
  const ehMorador = String(cargoTipo || '').toLowerCase() === 'morador';
  const ehConstrutora = isConstrutoraOrg || ehCargoConstrutora(cargoTipo);
  const ehEquipe = ehEquipeDoCondominio(cargoTipo) && !isGestaoTecnica;
  // Privativas: síndico/administração não veem. Comuns: morador não vê.
  const semAcesso = comuns ? ehMorador && !isGestaoTecnica : ehEquipe;
  // Só Gestão Técnica e construtora conversam; o resto só visualiza.
  const podeEscrever = isGestaoTecnica || ehConstrutora;
  const erroChat = comuns ? mensagemErroAreas : mensagemErroRecebimentoChat;
  const erroCadastro = comuns ? mensagemErroAreas : mensagemErroUnidade;
  const alvoDe = (item) => (comuns ? { areaId: item.id } : { unidadeId: item.id });
  const linkDe = (id) => `${cfg.rota}/${id}`;

  const [unidades, setUnidades] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [itens, setItens] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('');
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agendar, setAgendar] = useState(false);
  // Cadastro das unidades/áreas: só a Gestão Técnica, em "Editar tela".
  const [editando, setEditando] = useState(false);
  const [unidadeModal, setUnidadeModal] = useState(null); // null | 'nova' | item
  const [okUnidades, setOkUnidades] = useState('');
  const editandoRef = useRef(false);
  editandoRef.current = editando;
  const chatLogRef = useRef(null);

  const aberta = unidades.find((u) => u.id === unidadeId) || null;
  const semOrdem = !comuns && unidades.length > 0 && unidades.every((u) => !('ordem' in u));

  // Ao trocar entre as duas telas, a página é reaproveitada: começa limpa.
  useEffect(() => {
    setUnidades([]);
    setItens([]);
    setCarregado(false);
    setEditando(false);
    setQ('');
    setFiltro('');
    setOkUnidades('');
    setError('');
  }, [modo]);

  async function loadLista() {
    if (!condoId || semAcesso) return;
    try {
      let lista;
      if (comuns) {
        lista = await listarChatsAreas(condoId);
      } else {
        let somenteIds = null;
        if (ehMorador) {
          // O morador vê só o(s) apartamento(s) ligado(s) a ele.
          const minhas = await unidadesDoMorador(condoId, session.user.id);
          somenteIds = minhas.map((u) => u.id);
        }
        lista = await listarChatsUnidades(condoId, { somenteIds });
      }
      setUnidades(lista);
      setError('');
      // Morador com um só imóvel: abre direto o chat dele.
      if (!comuns && ehMorador && !unidadeId && lista.length === 1) navigate(linkDe(lista[0].id), { replace: true });
    } catch (err) {
      setError(erroChat(err));
    } finally {
      setCarregado(true);
    }
  }

  async function loadChat(id = unidadeId) {
    if (!id || semAcesso) {
      setItens([]);
      return;
    }
    try {
      setItens(await carregarChatUnidade(id, cfg.campo));
    } catch (err) {
      setError(erroChat(err));
    }
  }

  useEffect(() => { loadLista(); }, [condoId, ehMorador, session?.user?.id, modo, semAcesso]);
  useEffect(() => { loadChat(unidadeId); }, [unidadeId, modo]);

  // Atualiza o chat aberto de tempos em tempos (mensagens da outra parte).
  useEffect(() => {
    if (!unidadeId) return undefined;
    const t = setInterval(() => {
      loadChat(unidadeId);
      // Enquanto a Gestão Técnica organiza a lista, ela não é recarregada por baixo.
      if (!editandoRef.current) loadLista();
    }, 20000);
    return () => clearInterval(t);
  }, [unidadeId, condoId, modo]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [itens]);

  const contagem = useMemo(() => {
    const c = {};
    for (const u of unidades) c[u.status] = (c[u.status] || 0) + 1;
    return c;
  }, [unidades]);

  const visiveis = unidades.filter((u) => (!filtro || u.status === filtro)
    && `${u.rotulo} ${u.preview}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function enviar(e) {
    e.preventDefault();
    if (!aberta || !texto.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await enviarMensagemUnidade({ ...alvoDe(aberta), condominioId: condoId, userId: session.user.id, texto });
      setTexto('');
      await Promise.all([loadChat(), loadLista()]);
    } catch (err) {
      setError(erroChat(err));
    } finally {
      setSending(false);
    }
  }

  async function enviarArquivo(file) {
    if (!aberta || !file) return;
    setSending(true);
    setError('');
    try {
      await enviarMensagemUnidade({ ...alvoDe(aberta), condominioId: condoId, userId: session.user.id, texto: '', files: [file] });
      await Promise.all([loadChat(), loadLista()]);
    } catch (err) {
      setError(erroChat(err));
    } finally {
      setSending(false);
    }
  }

  async function salvarVistoria({ titulo, descricao, dataEvento, files }) {
    setBusy(true);
    setError('');
    try {
      await agendarVistoriaUnidade({ ...alvoDe(aberta), condominioId: condoId, userId: session.user.id, titulo, descricao, dataEvento, files });
      setAgendar(false);
      await Promise.all([loadChat(), loadLista()]);
    } catch (err) {
      setError(erroChat(err));
      setAgendar(false);
      // A vistoria pode ter sido criada antes de um anexo falhar: mostra o que ficou salvo.
      await Promise.all([loadChat(), loadLista()]);
    } finally {
      setBusy(false);
    }
  }

  async function criarNovas(novas) {
    setBusy(true);
    setOkUnidades('');
    try {
      const { criadas, repetidas } = comuns
        ? await criarAreas(condoId, novas, unidades)
        : await criarUnidades(condoId, novas, unidades, { comOrdem: !semOrdem });
      if (!criadas) {
        throw new Error(repetidas === 1 ? `Essa ${cfg.item} já existe.` : `Todas essas ${cfg.itens} já existem.`);
      }
      setUnidadeModal(null);
      setOkUnidades(`${criadas === 1 ? `1 ${cfg.item} criada` : `${criadas} ${cfg.itens} criadas`}${repetidas ? ` · ${repetidas} já existia(m) e foi(ram) pulada(s)` : ''}.`);
      await loadLista();
    } catch (err) {
      throw new Error(erroCadastro(err));
    } finally {
      setBusy(false);
    }
  }

  async function salvarEdicaoUnidade(dados) {
    if (!unidadeModal || unidadeModal === 'nova') return;
    setBusy(true);
    setOkUnidades('');
    try {
      if (comuns) await editarArea(unidadeModal, dados, unidades);
      else await editarUnidade(unidadeModal, dados, unidades);
      setUnidadeModal(null);
      setOkUnidades(comuns ? 'Área atualizada.' : 'Unidade atualizada.');
      await loadLista();
    } catch (err) {
      throw new Error(erroCadastro(err));
    } finally {
      setBusy(false);
    }
  }

  async function apagarUnidade(u) {
    setError('');
    setOkUnidades('');
    if (!comuns) {
      const moradores = await contarMoradoresUnidade(u.id);
      if (moradores) {
        setError(`${u.rotulo} tem ${moradores === 1 ? '1 morador vinculado' : `${moradores} moradores vinculados`}. Desvincule antes de excluir.`);
        return;
      }
    }
    const aviso = u.status !== 'sem_vistoria'
      ? `Excluir ${u.rotulo}? O chat de recebimento desta ${cfg.item} também será apagado. Não dá para desfazer.`
      : `Excluir ${u.rotulo}? Não dá para desfazer.`;
    if (!window.confirm(aviso)) return;
    setBusy(true);
    try {
      if (comuns) await excluirArea(u.id);
      else await excluirUnidade(u.id);
      if (u.id === unidadeId) navigate(cfg.rota);
      setOkUnidades(`${u.rotulo} excluída.`);
      await loadLista();
    } catch (err) {
      setError(erroCadastro(err));
    } finally {
      setBusy(false);
    }
  }

  async function salvarOrdem(lista, idsAntes) {
    setError('');
    setOkUnidades('');
    try {
      if (comuns) await salvarOrdemAreas(lista, idsAntes);
      else await salvarOrdemUnidades(lista, idsAntes);
      setUnidades((atual) => atual.map((u) => ({ ...u, ordem: lista.findIndex((x) => x.id === u.id) })));
      setOkUnidades(`Ordem das ${cfg.itens} salva.`);
    } catch (err) {
      setError(erroCadastro(err));
      await loadLista();
    }
  }

  const podeOrdenar = isGestaoTecnica && editando && !q.trim() && !filtro && !semOrdem && unidades.length > 1;
  const { arrastandoId, propsItem } = useArrastarOrdenar({
    itens: unidades,
    setItens: setUnidades,
    getId: (u) => u.id,
    ativo: podeOrdenar,
    onSoltar: salvarOrdem,
    ignorar: '.rec-item-acoes',
  });

  async function alternarOk() {
    if (!aberta) return;
    const ok = aberta.status === 'ok';
    const pergunta = ok
      ? `Remover o OK de ${aberta.rotulo}? A ${cfg.item} volta a ficar em andamento.`
      : `Marcar ${aberta.rotulo} como OK? Significa que a entrega foi concluída sem pendências.`;
    if (!window.confirm(pergunta)) return;
    setBusy(true);
    setError('');
    try {
      if (ok) await desmarcarUnidadeOk(aberta.id, cfg.campo);
      else await marcarUnidadeOk({ ...alvoDe(aberta), condominioId: condoId, userId: session.user.id });
      await Promise.all([loadChat(), loadLista()]);
    } catch (err) {
      setError(erroChat(err));
    } finally {
      setBusy(false);
    }
  }

  if (semAcesso) {
    return (
      <Page title={cfg.titulo} className="page-suporte page-recebimento">
        <Empty
          text={comuns
            ? 'O recebimento das áreas comuns é acompanhado pela administração do condomínio, Gestão Técnica e construtora.'
            : 'O recebimento das áreas privativas é acompanhado por cada morador, pela Gestão Técnica e pela construtora.'}
        />
      </Page>
    );
  }

  const lead = comuns
    ? (podeEscrever
      ? 'Um chat por área comum entre a Gestão Técnica e a construtora sobre a vistoria de entrega.'
      : 'Acompanhe a vistoria de entrega das áreas comuns. A conversa é entre a Gestão Técnica e a construtora.')
    : ehMorador
      ? 'Acompanhe a vistoria de entrega do seu imóvel. A conversa é entre a Gestão Técnica e a construtora.'
      : 'Um chat por unidade entre a Gestão Técnica e a construtora sobre a vistoria de entrega.';

  const vazio = !comuns && ehMorador
    ? 'Seu usuário ainda não está ligado a uma unidade.'
    : unidades.length
      ? `Nenhuma ${cfg.item} encontrada.`
      : isGestaoTecnica
        ? `Nenhuma ${cfg.item} cadastrada. Clique em "Editar tela" e depois em "${comuns ? 'Nova área' : 'Nova unidade'}".`
        : `Nenhuma ${cfg.item} cadastrada ainda.`;

  return (
    <Page
      title={cfg.titulo}
      lead={lead}
      className="page-suporte page-recebimento"
      actions={isGestaoTecnica ? (
        <EditTelaButton
          editing={editando}
          onToggle={() => { setEditando((v) => !v); setOkUnidades(''); }}
        />
      ) : null}
    >
      <Alert error={error} ok={okUnidades} />
      {comuns || !ehMorador || unidades.length > 1 ? (
        <div className="row chamado-filters">
          <label className="search-field">
            <Icon name="search" size={16} />
            <input placeholder={comuns ? 'Pesquisar área' : 'Pesquisar unidade'} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="">Todas ({unidades.length})</option>
            <option value="sem_vistoria">Sem vistoria ({contagem.sem_vistoria || 0})</option>
            <option value="chat">Em andamento ({contagem.chat || 0})</option>
            <option value="ok">OK ({contagem.ok || 0})</option>
          </select>
        </div>
      ) : null}

      <div className={`suporte-layout suporte-layout--mobile-nav${unidadeId ? ' suporte-layout--open' : ''}`}>
        <aside className="panel suporte-list rec-lista">
          {isGestaoTecnica && editando ? (
            <div className="rec-cadastro">
              <Btn icon="plus" onClick={() => setUnidadeModal('nova')} disabled={busy}>{comuns ? 'Nova área' : 'Nova unidade'}</Btn>
              <p className="hint">
                {semOrdem
                  ? 'Para mudar a ordem, rode o arquivo supabase/unidades-ordem.sql no Supabase.'
                  : podeOrdenar
                    ? `Arraste as ${cfg.itens} para mudar a ordem.`
                    : unidades.length > 1
                      ? 'Limpe a pesquisa e o filtro para arrastar e mudar a ordem.'
                      : comuns
                        ? 'Cadastre as áreas comuns do condomínio (piscina, salão de festas, hall…).'
                        : 'Cadastre os apartamentos do condomínio. Depois cada morador é ligado à sua unidade.'}
              </p>
            </div>
          ) : null}
          {carregado && !visiveis.length ? (
            <Empty text={vazio} />
          ) : visiveis.map((u) => {
            const conteudo = (
              <>
                <div className="suporte-item-top">
                  <strong className="suporte-item-name rec-item-nome">
                    {u.status === 'ok' ? <span className="rec-item-check" aria-hidden="true"><Icon name="check" size={12} /></span> : null}
                    {u.rotulo}
                  </strong>
                  <SeloRecebimento status={u.status} />
                </div>
                <small className="suporte-item-preview">
                  {u.preview || (u.status === 'sem_vistoria' ? 'Nenhuma vistoria ainda' : STATUS_CHAT[u.status]?.label)}
                </small>
              </>
            );
            const classe = `suporte-item rec-item is-${u.status}${u.id === unidadeId ? ' active' : ''}`;
            if (!(isGestaoTecnica && editando)) {
              return (
                <button type="button" key={u.id} className={classe} onClick={() => navigate(linkDe(u.id))}>
                  {conteudo}
                </button>
              );
            }
            // Modo edição: a linha arrasta, abre o chat ao clicar e tem editar/excluir.
            return (
              <div
                key={u.id}
                role="button"
                tabIndex={0}
                {...propsItem(u)}
                className={[classe, 'rec-item--editando', podeOrdenar ? 'arr-ordenavel' : '', arrastandoId === u.id ? 'arr-lugar' : ''].filter(Boolean).join(' ')}
                onClick={() => navigate(linkDe(u.id))}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(linkDe(u.id)); }}
              >
                {podeOrdenar ? <span className="rec-item-pegador" aria-hidden="true"><Icon name="menu" size={16} /></span> : null}
                <div className="rec-item-corpo">{conteudo}</div>
                <div className="rec-item-acoes">
                  <button
                    type="button"
                    className="rec-item-acao"
                    title={`Editar ${cfg.item}`}
                    aria-label={`Editar ${u.rotulo}`}
                    onClick={(e) => { e.stopPropagation(); setUnidadeModal(u); }}
                    disabled={busy}
                  >
                    <Icon name="pencil" size={15} />
                  </button>
                  <button
                    type="button"
                    className="rec-item-acao is-perigo"
                    title={`Excluir ${cfg.item}`}
                    aria-label={`Excluir ${u.rotulo}`}
                    onClick={(e) => { e.stopPropagation(); apagarUnidade(u); }}
                    disabled={busy}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </aside>

        <section className={`chat-shell suporte-chat${aberta ? '' : ' empty'}`}>
          {!aberta ? (
            <Empty text={carregado ? `Selecione uma ${cfg.item} para abrir o chat.` : 'Carregando…'} />
          ) : (
            <>
              <div className="chat-top">
                <button type="button" className="suporte-back" onClick={() => navigate(cfg.rota)}>
                  <Icon name="chevron" size={18} />
                  {cfg.voltar}
                </button>
                <ChatHeader
                  icon={cfg.icone}
                  title={aberta.rotulo}
                  subtitle={aberta.status === 'ok' ? 'Entrega OK' : aberta.status === 'chat' ? 'Vistoria em andamento' : 'Sem vistoria'}
                >
                  <SeloRecebimento status={aberta.status} />
                  {isGestaoTecnica ? (
                    <Btn variant="ghost" icon="calendar" onClick={() => setAgendar(true)} disabled={busy}>
                      Agendar vistoria
                    </Btn>
                  ) : null}
                  {isGestaoTecnica ? (
                    <Btn
                      variant={aberta.status === 'ok' ? 'ghost' : 'primary'}
                      icon={aberta.status === 'ok' ? 'x' : 'check'}
                      className={aberta.status === 'ok' ? '' : 'rec-btn-ok'}
                      onClick={alternarOk}
                      disabled={busy}
                    >
                      {aberta.status === 'ok' ? 'Remover OK' : 'Marcar OK'}
                    </Btn>
                  ) : null}
                </ChatHeader>
              </div>
              <div className="chat-log" ref={chatLogRef}>
                {!itens.length ? (
                  <Empty text={isGestaoTecnica ? 'Nenhuma mensagem ainda. Comece agendando a vistoria.' : 'Nenhuma mensagem ainda.'} />
                ) : itens.map((item) => (item.kind === 'msg' ? (
                  <ChatMensagem
                    key={item.id}
                    mensagem={item.mensagem}
                    mine={item.mensagem.usuario_id === session?.user?.id}
                    quando={formatChatTime(item.at)}
                    mostrarNome
                  />
                ) : (
                  <EventoChat key={item.id} registro={item.registro} />
                )))}
              </div>
              {podeEscrever ? (
                <ChatComposer
                  value={texto}
                  onChange={setTexto}
                  sending={sending}
                  onSend={enviar}
                  onFile={enviarArquivo}
                  placeholder={isGestaoTecnica ? 'Escreva para a construtora' : 'Escreva para a Gestão Técnica'}
                />
              ) : (
                <p className="hint chat-readonly">Somente visualização</p>
              )}
            </>
          )}
        </section>
      </div>

      <AgendarVistoriaModal
        open={agendar}
        unidade={aberta?.rotulo}
        busy={busy}
        onClose={() => setAgendar(false)}
        onSalvar={salvarVistoria}
      />

      {comuns ? (
        <AreaModal
          open={Boolean(unidadeModal)}
          area={unidadeModal && unidadeModal !== 'nova' ? unidadeModal : null}
          busy={busy}
          condoId={condoId}
          onClose={() => setUnidadeModal(null)}
          onCriar={criarNovas}
          onEditar={salvarEdicaoUnidade}
        />
      ) : (
        <UnidadeModal
          open={Boolean(unidadeModal)}
          unidade={unidadeModal && unidadeModal !== 'nova' ? unidadeModal : null}
          busy={busy}
          onClose={() => setUnidadeModal(null)}
          onCriar={criarNovas}
          onEditar={salvarEdicaoUnidade}
        />
      )}
    </Page>
  );
}
