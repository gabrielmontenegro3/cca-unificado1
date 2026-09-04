import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { can, STATUS_CHAMADO, STATUS_LABEL } from '../lib/permissions';
import {
  chamadoNumero,
  formatDateTime,
} from '../lib/format';
import {
  listarArquivosAberturaChamado,
  listarRastreabilidadeChamado,
  listarUsuariosCondominio,
  proximoNumeroInspecao,
  publicOrSignedUrl,
  registrarRastreabilidadeChamado,
  arquivoEhImagem,
} from '../lib/api';
import {
  buildTimeline,
  labelRastreabilidade,
  tipoLabelEvento,
  tiposRastreabilidadePermitidos,
  tituloRastreabilidade,
} from '../lib/chamadoRastreabilidade';
import { exportarRelatorioChamado } from '../lib/chamadoRelatorio';
import { Alert, Badge, Btn, Empty, Field, Page } from '../components/ui';
import { Icon } from '../components/icons';
import { Modal } from '../components/DataList';

function TraceGallery({ arquivos }) {
  const [items, setItems] = useState(arquivos || []);

  useEffect(() => {
    let live = true;
    const list = arquivos || [];
    (async () => {
      const next = await Promise.all(list.map(async (arquivo) => {
        if (!arquivo?.storage_path) return { ...arquivo, isImage: arquivoEhImagem(arquivo) };
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
  }, [arquivos]);

  if (!items.length) return null;

  return (
    <div className="trace-gallery">
      {items.map((arquivo) => {
        const key = arquivo.id || arquivo.storage_path;
        const caption = arquivo.descricao_foto;
        if (arquivo.isImage && arquivo.url) {
          return (
            <figure key={key} className="trace-gallery-item">
              <a href={arquivo.url} target="_blank" rel="noreferrer">
                <img src={arquivo.url} alt={arquivo.nome_original || 'Foto'} />
              </a>
              {caption ? <figcaption>{caption}</figcaption> : null}
            </figure>
          );
        }
        if (arquivo.url) {
          return (
            <a key={key} className="trace-file" href={arquivo.url} target="_blank" rel="noreferrer">
              <Icon name="file" size={16} />
              {arquivo.nome_original || 'Arquivo'}
            </a>
          );
        }
        return null;
      })}
    </div>
  );
}

function TraceEventCard({ item, inspecoes }) {
  const titulo = item.titulo || tituloRastreabilidade(item);
  const tipoLabel = tipoLabelEvento(item);
  const quem = item.registrado?.nome || item.usuarios?.nome;
  const parentInspecao = item.parent_id
    ? inspecoes.find((i) => i.id === item.parent_id)
    : null;

  return (
    <article className={`trace-card trace-card--${item.tipo || item.kind}`}>
      <header className="trace-card-head">
        <span className="trace-card-badge">{tipoLabel}</span>
        <time>{formatDateTime(item.when || item.created_at)}</time>
      </header>
      <h3 className="trace-card-title">{titulo}</h3>
      {quem ? <p className="trace-card-meta">Por {quem}</p> : null}
      {parentInspecao ? (
        <p className="trace-card-meta">
          Vinculado à {parentInspecao.numero_inspecao}ª inspeção
        </p>
      ) : null}
      {item.observacao ? <p className="trace-card-text">{item.observacao}</p> : null}
      {item.descricao ? <p className="trace-card-text">{item.descricao}</p> : null}
      {item.atendentes?.length ? (
        <p className="trace-card-meta">
          Atendentes: {item.atendentes.map((a) => a.nome).join(', ')}
        </p>
      ) : null}
      <TraceGallery arquivos={item.arquivos} />
      {item.children?.length ? (
        <div className="trace-children">
          {item.children.map((child) => (
            <TraceEventCard key={child.id} item={child} inspecoes={inspecoes} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function RegistrarModal({
  open,
  onClose,
  tipos,
  inspecoes,
  staff,
  onSubmit,
  busy,
}) {
  const [tipo, setTipo] = useState(tipos[0] || '');
  const [descricao, setDescricao] = useState('');
  const [dataOcorrencia, setDataOcorrencia] = useState('');
  const [parentId, setParentId] = useState('');
  const [atendenteIds, setAtendenteIds] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileDescriptions, setFileDescriptions] = useState([]);

  useEffect(() => {
    if (open) {
      setTipo(tipos[0] || '');
      setDescricao('');
      setDataOcorrencia('');
      setParentId('');
      setAtendenteIds([]);
      setFiles([]);
      setFileDescriptions([]);
    }
  }, [open, tipos]);

  function onFilesChange(e) {
    const list = [...e.target.files || []];
    setFiles(list);
    setFileDescriptions(list.map(() => ''));
  }

  function toggleAtendente(id) {
    setAtendenteIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function submit(e) {
    e.preventDefault();
    await onSubmit({
      tipo,
      descricao,
      dataOcorrencia: dataOcorrencia || null,
      parentId: parentId || null,
      atendenteIds,
      files,
      fileDescriptions,
    });
  }

  const precisaFotos = ['inspecao', 'apontamento', 'repasse_construtora', 'repasse_administracao'].includes(tipo);
  const precisaAtendentes = tipo === 'atendimento';
  const precisaParent = tipo === 'apontamento';

  return (
    <Modal open={open} title="Criar evento" onClose={onClose} className="modal-sheet--trace">
      <form className="stack trace-form" onSubmit={submit}>
        <Field label="Tipo de evento">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} required>
            {tipos.map((t) => (
              <option key={t} value={t}>{labelRastreabilidade(t)}</option>
            ))}
          </select>
        </Field>

        {precisaParent ? (
          <Field label="Inspeção relacionada">
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} required>
              <option value="">Selecione…</option>
              {inspecoes.map((ins) => (
                <option key={ins.id} value={ins.id}>
                  {ins.numero_inspecao}ª inspeção — {formatDateTime(ins.created_at)}
                </option>
              ))}
            </select>
            {!inspecoes.length ? (
              <p className="hint" style={{ marginTop: 6 }}>
                Registre uma inspeção antes do apontamento.
              </p>
            ) : null}
          </Field>
        ) : null}

        {precisaAtendentes ? (
          <Field label="Usuários que fizeram o atendimento">
            <div className="catalog-multi">
              {staff.map((user) => {
                const uid = user.usuario_id || user.usuarios?.id || user.id;
                const checked = atendenteIds.includes(uid);
                return (
                  <label key={uid} className={`catalog-multi-item${checked ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAtendente(uid)}
                    />
                    <span>{user.nome || user.usuarios?.nome}</span>
                  </label>
                );
              })}
            </div>
          </Field>
        ) : null}

        <Field label="Descrição / informações">
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            required={tipo !== 'atendimento'}
            placeholder="Descreva o que ocorreu neste registro…"
          />
        </Field>

        <Field label="Data do ocorrido (opcional)">
          <input
            type="datetime-local"
            value={dataOcorrencia}
            onChange={(e) => setDataOcorrencia(e.target.value)}
          />
        </Field>

        {precisaFotos || tipo === 'atualizacao_cliente' || tipo === 'comunicado_construtora' || tipo === 'acao_construtora' ? (
          <Field label="Fotos ou documentos">
            <input
              type="file"
              multiple
              accept="image/*,.pdf"
              capture="environment"
              onChange={onFilesChange}
            />
            {files.map((file, index) => (
              <input
                key={`${file.name}-${index}`}
                className="trace-file-desc"
                placeholder={`Descrição da foto ${index + 1} (opcional)`}
                value={fileDescriptions[index] || ''}
                onChange={(e) => {
                  const next = [...fileDescriptions];
                  next[index] = e.target.value;
                  setFileDescriptions(next);
                }}
              />
            ))}
          </Field>
        ) : null}

        <div className="row">
          <Btn type="submit" icon="check" disabled={busy || (precisaParent && !parentId)}>
            {busy ? 'Salvando…' : 'Salvar evento'}
          </Btn>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        </div>
      </form>
    </Modal>
  );
}

export function RastreabilidadeListaPage() {
  const { condoId, cargoTipo } = useSession();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const podeAcessar = can(cargoTipo, 'manage_traceability');

  useEffect(() => {
    if (!condoId || !podeAcessar) return;
    supabase
      .from('chamados')
      .select('*, usuarios:solicitante_id(nome), unidades(identificacao)')
      .eq('condominio_id', condoId)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setRows(data || []);
      });
  }, [condoId, podeAcessar]);

  if (!podeAcessar) return <Navigate to="/visao-geral" replace />;

  const filtered = rows.filter((row) => {
    const text = `${row.titulo} ${row.numero_registro} ${row.usuarios?.nome || ''}`.toLowerCase();
    return (!status || row.status === status) && text.includes(q.toLowerCase());
  });

  return (
    <Page
      title="Rastreabilidade"
      lead="Linha do tempo e relatório PDF dos chamados deste condomínio."
    >
      <Alert error={error} />
      <div className="row chamado-filters">
        <label className="search-field">
          <Icon name="search" size={16} />
          <input placeholder="Pesquisar chamado" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_CHAMADO.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      {!filtered.length ? (
        <Empty text="Nenhum chamado encontrado." />
      ) : (
        <div className="ticket-list">
          {filtered.map((row) => (
            <Link
              className="ticket-card"
              key={row.id}
              to={`/rastreabilidade/${row.id}`}
            >
              <div className="ticket-card-top">
                <strong>{chamadoNumero(row.numero_registro)}</strong>
                <Badge value={row.status} />
              </div>
              <span className="ticket-card-title">{row.titulo}</span>
              <small>
                {row.unidades?.identificacao || 'Unidade'}
                {row.usuarios?.nome ? ` · ${row.usuarios.nome}` : ''}
                {' · '}
                {formatDateTime(row.updated_at)}
              </small>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

export function ChamadoRastreabilidadePage() {
  const { id } = useParams();
  const { condoId, cargoTipo, session, selectCondo } = useSession();
  const [chamado, setChamado] = useState(null);
  const [registros, setRegistros] = useState([]);
  const [fotosAbertura, setFotosAbertura] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const podeAcessar = can(cargoTipo, 'manage_traceability');

  const tipos = tiposRastreabilidadePermitidos(cargoTipo);
  const podeRegistrar = tipos.length > 0;
  const inspecoes = registros.filter((r) => r.tipo === 'inspecao');
  const staffAtendimento = staff.filter((u) => {
    const t = String(u.cargoTipo || u.cargos?.tipo || '').toLowerCase();
    return t && t !== 'morador';
  });
  const condominioId = chamado?.condominio_id || condoId;

  async function load() {
    const { data, error: err } = await supabase
      .from('chamados')
      .select('*, usuarios:solicitante_id(nome), unidades(identificacao)')
      .eq('id', id)
      .single();
    if (err) return setError(err.message);
    setChamado(data);
    if (data?.condominio_id && data.condominio_id !== condoId) {
      selectCondo(data.condominio_id);
    }

    const hist = await supabase
      .from('chamado_status_historico')
      .select('*, usuarios:alterado_por(nome)')
      .eq('chamado_id', id)
      .order('created_at');
    setHistorico(hist.data || []);

    try {
      setFotosAbertura(await listarArquivosAberturaChamado(id));
    } catch {
      setFotosAbertura([]);
    }

    try {
      setRegistros(await listarRastreabilidadeChamado(id));
    } catch (regErr) {
      if (/schema cache|could not find|does not exist/i.test(String(regErr.message || ''))) {
        setRegistros([]);
      } else {
        setError(regErr.message);
      }
    }
  }

  useEffect(() => {
    if (!podeAcessar) return;
    load();
  }, [id, podeAcessar]);

  useEffect(() => {
    if (!condominioId || !podeAcessar) return;
    listarUsuariosCondominio(condominioId).then(setStaff).catch(() => setStaff([]));
  }, [condominioId, podeAcessar]);

  const timeline = useMemo(
    () => (chamado ? buildTimeline(chamado, fotosAbertura, registros, historico) : []),
    [chamado, fotosAbertura, registros, historico],
  );

  async function onRegistrar(form) {
    setBusy(true);
    setError('');
    try {
      let numeroInspecao = null;
      if (form.tipo === 'inspecao') {
        numeroInspecao = await proximoNumeroInspecao(id);
      }
      let dataOcorrencia = form.dataOcorrencia;
      if (dataOcorrencia && !dataOcorrencia.includes('T')) {
        dataOcorrencia = `${dataOcorrencia}T12:00:00`;
      }
      await registrarRastreabilidadeChamado({
        chamadoId: id,
        condominioId,
        userId: session.user.id,
        tipo: form.tipo,
        descricao: form.descricao,
        dataOcorrencia: dataOcorrencia || null,
        parentId: form.parentId,
        numeroInspecao,
        atendenteIds: form.atendenteIds,
        files: form.files,
        fileDescriptions: form.fileDescriptions,
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível registrar.');
    } finally {
      setBusy(false);
    }
  }

  async function onExportPdf() {
    setExporting(true);
    setError('');
    try {
      await exportarRelatorioChamado({
        chamado,
        timeline,
        inspecoes,
      });
    } catch (err) {
      setError(err.message || 'Não foi possível gerar o PDF.');
    } finally {
      setExporting(false);
    }
  }

  if (!podeAcessar) return <Navigate to="/visao-geral" replace />;

  if (!chamado) {
    return <Page title="Rastreabilidade"><Alert error={error} /></Page>;
  }

  return (
    <Page
      title="Rastreabilidade"
      lead={`${chamadoNumero(chamado.numero_registro)} · ${chamado.titulo}`}
      actions={
        <div className="row trace-actions">
          {podeRegistrar ? (
            <Btn icon="plus" onClick={() => setModalOpen(true)}>Criar evento</Btn>
          ) : null}
          <Btn variant="ghost" to={`/agendar-visita?chamado=${id}`} icon="calendar">Agendar visita</Btn>
          <Btn variant="ghost" to="/rastreabilidade" icon="layers">Chamados</Btn>
          <Btn variant="ghost" to={`/chamados/${id}`} icon="message">Chat</Btn>
          <Btn variant="ghost" onClick={onExportPdf} icon="file" disabled={exporting}>
            {exporting ? 'Gerando PDF…' : 'Exportar PDF'}
          </Btn>
        </div>
      }
    >
      <Alert error={error} />

      <section className="trace-summary panel">
        <div className="trace-summary-grid">
          <div>
            <span className="label">Solicitante</span>
            <strong>{chamado.usuarios?.nome || '—'}</strong>
          </div>
          <div>
            <span className="label">Unidade</span>
            <strong>{chamado.unidades?.identificacao || '—'}</strong>
          </div>
          <div>
            <span className="label">Abertura</span>
            <strong>{formatDateTime(chamado.created_at)}</strong>
          </div>
          <div>
            <span className="label">Status</span>
            <strong>{STATUS_LABEL[chamado.status] || chamado.status}</strong>
          </div>
        </div>
        <p className="trace-summary-problem">
          <span className="label">Problema</span>
          {chamado.titulo}
        </p>
      </section>

      {timeline.length ? (
        <ol className="trace-timeline">
          {timeline.map((item, index) => (
            <li key={item.id} className="trace-timeline-item">
              <span className="trace-timeline-dot" aria-hidden="true" />
              {index < timeline.length - 1 ? <span className="trace-timeline-line" aria-hidden="true" /> : null}
              <TraceEventCard item={item} inspecoes={inspecoes} />
            </li>
          ))}
        </ol>
      ) : (
        <Empty text="Nenhum evento ainda." />
      )}

      {podeRegistrar ? (
        <div className="trace-create-bar">
          <Btn icon="plus" onClick={() => setModalOpen(true)}>Criar evento</Btn>
          <p className="hint">Inspeção, atendimento, repasse, comunicação e outros registros entram na linha do tempo.</p>
        </div>
      ) : null}

      <RegistrarModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        tipos={tipos}
        inspecoes={inspecoes}
        staff={staffAtendimento}
        onSubmit={onRegistrar}
        busy={busy}
      />
    </Page>
  );
}
