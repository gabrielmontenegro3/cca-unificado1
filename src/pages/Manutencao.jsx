import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { ehCargoAdministracao, PERIODICIDADE } from '../lib/permissions';
import { SUBSISTEMAS } from '../lib/especificidade';
import { publicOrSignedUrl, uploadArquivo } from '../lib/api';
import { addPeriod, hojeISO } from '../lib/format';
import { carregarSistemasManutencao, mensagemSqlManutencao } from '../lib/manutencaoExecucoes';
import { Alert, Btn, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { Icon } from '../components/icons';
import { ArquivoPreviewCard, formatarTamanho } from '../components/ArquivoPreview';

const CRIAR_SISTEMA = '__criar__';
const CRIAR_SUBSISTEMA = '__criar__';
const hoje = () => hojeISO();
// Data de hoje para exibição (dd/mm/aaaa), no fuso do aparelho.
const hojeLocal = () => new Date().toLocaleDateString('pt-BR');

const mensagemSql = mensagemSqlManutencao;

export function podeRegistrar(cargoTipo, isGestaoTecnica) {
  return isGestaoTecnica
    || ehCargoAdministracao(cargoTipo)
    || String(cargoTipo || '') === 'administrador';
}

async function comUrl(arquivo) {
  if (!arquivo?.storage_path) return { ...arquivo, url: '' };
  const { data } = await publicOrSignedUrl(arquivo.storage_path);
  return { ...arquivo, url: data?.signedUrl || '' };
}

function DocumentosManutencao({ condoId, userId, podeAnexar }) {
  const [docs, setDocs] = useState([]);
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!condoId) return;
    const { data, error: err } = await supabase
      .from('manutencao_documentos')
      .select('id, ordem, arquivos(id, nome_original, storage_path, mime_type, tipo, tamanho_bytes)')
      .eq('condominio_id', condoId)
      .order('ordem');
    if (err) {
      setError(mensagemSql(err));
      setDocs([]);
      return;
    }
    const lista = await Promise.all((data || []).map(async (row) => {
      const arquivo = Array.isArray(row.arquivos) ? row.arquivos[0] : row.arquivos;
      if (!arquivo) return null;
      const comImagem = await comUrl(arquivo);
      return { vinculoId: row.id, ...comImagem };
    }));
    setDocs(lista.filter(Boolean));
    setError('');
  }

  useEffect(() => { load(); }, [condoId]);

  async function anexar(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const arquivo = await uploadArquivo({
        condominioId: condoId,
        userId,
        file,
        folder: 'manutencao-documentos',
      });
      const { error: err } = await supabase.from('manutencao_documentos').insert({
        condominio_id: condoId,
        arquivo_id: arquivo.id,
        ordem: docs.length,
      });
      if (err) throw err;
      setFile(null);
      setFileKey((value) => value + 1);
      await load();
    } catch (err) {
      setError(mensagemSql(err));
    } finally {
      setBusy(false);
    }
  }

  async function remover(doc) {
    if (!doc?.vinculoId) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.from('manutencao_documentos').delete().eq('id', doc.vinculoId);
    setBusy(false);
    if (err) {
      setError(mensagemSql(err));
      return;
    }
    load();
  }

  return (
    <section className="manut-docs">
      <div className="manut-docs-head">
        <h2>Documentos</h2>
        {podeAnexar ? (
          <form className="manut-docs-form" onSubmit={anexar}>
            <input
              key={fileKey}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <Btn type="submit" icon="paperclip" disabled={busy || !file}>
              {busy ? 'Anexando…' : 'Anexar'}
            </Btn>
          </form>
        ) : null}
      </div>
      <Alert error={error} />
      {docs.length ? (
        <ul className="manut-docs-grid">
          {docs.map((doc) => (
            <li key={doc.vinculoId}>
              <ArquivoPreviewCard
                arquivo={doc}
                url={doc.url}
                compact
                actions={podeAnexar ? (
                  <button
                    type="button"
                    className="arquivo-preview-btn arquivo-preview-btn--ghost"
                    disabled={busy}
                    onClick={() => remover(doc)}
                    aria-label={`Remover ${doc.nome_original || 'documento'}`}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                ) : null}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint manut-docs-vazio">Nenhum documento anexado.</p>
      )}
    </section>
  );
}

function mesmoNome(a, b) {
  return String(a || '').trim().toLocaleLowerCase('pt-BR') === String(b || '').trim().toLocaleLowerCase('pt-BR');
}

function NovoNome({ label, placeholder, onAdicionar, onCancelar }) {
  const [nome, setNome] = useState('');
  return (
    <div className="manut-novo-sub">
      <Field label={label}>
        <input
          value={nome}
          autoFocus
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAdicionar(nome);
            }
          }}
          placeholder={placeholder}
        />
      </Field>
      <div className="manut-novo-sub-acoes">
        <Btn type="button" icon="plus" onClick={() => onAdicionar(nome)}>Adicionar e selecionar</Btn>
        <Btn type="button" variant="ghost" onClick={onCancelar}>Cancelar</Btn>
      </div>
    </div>
  );
}

function RegistrarExecucao({ condoId, userId, sistemas, subsistemasDe, onCriarSistema, onCriarSubsistema, onRegistrado }) {
  const [form, setForm] = useState({ sistema: '', subsistema: '', descricao: '' });
  // Qual lista está em modo "criar novo": 'sistema', 'subsistema' ou ''.
  const [criando, setCriando] = useState('');
  const [anexos, setAnexos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const fileRef = useRef(null);
  const subsistemas = form.sistema ? subsistemasDe(form.sistema) : [];

  function escolherSistema(value) {
    setOk('');
    setError('');
    if (value === CRIAR_SISTEMA) {
      setCriando('sistema');
      return;
    }
    setCriando('');
    setForm({ ...form, sistema: value, subsistema: '' });
  }

  function escolherSubsistema(value) {
    setOk('');
    setError('');
    if (value === CRIAR_SUBSISTEMA) {
      setCriando('subsistema');
      return;
    }
    setCriando('');
    setForm({ ...form, subsistema: value });
  }

  async function adicionarSistema(texto) {
    const nome = String(texto || '').trim();
    if (!nome) {
      setError('Digite o nome do novo sistema construtivo.');
      return;
    }
    setError('');
    const valor = sistemas.find((item) => mesmoNome(item, nome)) || await onCriarSistema(nome);
    setForm({ ...form, sistema: valor, subsistema: '' });
    setCriando('');
  }

  async function adicionarSubsistema(texto) {
    const nome = String(texto || '').trim();
    if (!nome) {
      setError('Digite o nome do novo subsistema.');
      return;
    }
    setError('');
    const valor = subsistemas.find((item) => mesmoNome(item, nome)) || await onCriarSubsistema(form.sistema, nome);
    setForm({ ...form, subsistema: valor });
    setCriando('');
  }

  function adicionarArquivos(lista) {
    const novos = [...(lista || [])];
    if (!novos.length) return;
    setAnexos((atual) => [...atual, ...novos]);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function registrar(e) {
    e.preventDefault();
    setOk('');
    if (criando) {
      setError(`Termine de criar o ${criando === 'sistema' ? 'sistema construtivo' : 'subsistema'} (Adicionar e selecionar) ou cancele.`);
      return;
    }
    if (!form.sistema) {
      setError('Selecione primeiro o sistema construtivo.');
      return;
    }
    if (!form.subsistema) {
      setError('Selecione o subsistema da execução.');
      return;
    }
    if (!form.descricao.trim()) {
      setError('Descreva o que foi feito.');
      return;
    }
    setBusy(true);
    setError('');
    const enviados = [];
    try {
      for (const file of anexos) {
        const arquivo = await uploadArquivo({ condominioId: condoId, userId, file, folder: 'manutencao-execucoes' });
        enviados.push(arquivo.id);
      }
      const params = {
        p_condominio_id: condoId,
        p_sistema: form.sistema,
        p_subsistema: form.subsistema,
        // A data é definida pelo banco: sempre o dia do envio.
        p_data: null,
        p_observacao: form.descricao.trim(),
      };
      if (enviados.length) params.p_arquivos = enviados;
      const { error: err } = await supabase.rpc('registrar_execucao_manutencao', params);
      if (err) throw err;
      setForm({ sistema: form.sistema, subsistema: form.subsistema, descricao: '' });
      setAnexos([]);
      setOk('Execução registrada.');
      onRegistrado?.();
    } catch (err) {
      if (enviados.length) await supabase.from('arquivos').delete().in('id', enviados);
      setError(mensagemSql(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel manut-execucao" onSubmit={registrar}>
      <header className="manut-execucao-head">
        <span className="manut-execucao-icon" aria-hidden="true"><Icon name="clipboard" size={20} /></span>
        <div>
          <h2>Registrar execução</h2>
          <p className="hint">Escolha o sistema construtivo, depois o subsistema, descreva o serviço e anexe os comprovantes.</p>
        </div>
      </header>
      <Alert error={error} ok={ok} />
      <div className="manut-execucao-grid">
        <Field label="Sistema construtivos">
          <select
            value={criando === 'sistema' ? CRIAR_SISTEMA : form.sistema}
            onChange={(e) => escolherSistema(e.target.value)}
            required
          >
            <option value="">Selecione o sistema construtivo</option>
            {sistemas.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
            <option value={CRIAR_SISTEMA}>+ Criar novo sistema…</option>
          </select>
        </Field>
        <Field label="Data da execução">
          <input type="text" value={hojeLocal()} readOnly disabled />
        </Field>
      </div>
      {criando === 'sistema' ? (
        <NovoNome
          label="Nome do novo sistema construtivo"
          placeholder="Ex.: Sistema de combate a incêndio"
          onAdicionar={adicionarSistema}
          onCancelar={() => setCriando('')}
        />
      ) : null}
      <Field label="Subsistemas">
        <select
          value={criando === 'subsistema' ? CRIAR_SUBSISTEMA : form.subsistema}
          onChange={(e) => escolherSubsistema(e.target.value)}
          disabled={!form.sistema || criando === 'sistema'}
          required
        >
          <option value="">
            {!form.sistema
              ? 'Escolha primeiro o sistema construtivo'
              : subsistemas.length ? `Selecione o subsistema de ${form.sistema}` : `Nenhum subsistema em ${form.sistema} ainda`}
          </option>
          {subsistemas.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
          {form.sistema ? <option value={CRIAR_SUBSISTEMA}>+ Criar novo subsistema…</option> : null}
        </select>
      </Field>
      {criando === 'subsistema' ? (
        <NovoNome
          label={`Novo subsistema de ${form.sistema}`}
          placeholder="Ex.: Água fria"
          onAdicionar={adicionarSubsistema}
          onCancelar={() => setCriando('')}
        />
      ) : null}
      <p className="hint">A data da execução é registrada automaticamente como o dia do envio.</p>
      <Field label="Descrição">
        <textarea
          value={form.descricao}
          rows={4}
          onChange={(e) => setForm({ ...form, descricao: e.target.value })}
          placeholder="O que foi feito, por quem, observações…"
          required
        />
      </Field>
      <div className="manut-anexos">
        <span className="manut-anexos-label">Arquivos da execução</span>
        <label className="manut-anexos-drop">
          <input
            ref={fileRef}
            type="file"
            multiple
            onChange={(e) => adicionarArquivos(e.target.files)}
          />
          <Icon name="paperclip" size={18} />
          <span>Toque para anexar fotos, notas ou relatórios</span>
        </label>
        {anexos.length ? (
          <ul className="manut-anexos-lista">
            {anexos.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                <Icon name={String(file.type).startsWith('image/') ? 'eye' : 'file'} size={15} />
                <span className="manut-anexos-nome">{file.name}</span>
                <small>{formatarTamanho(file.size)}</small>
                <button
                  type="button"
                  aria-label={`Remover ${file.name}`}
                  onClick={() => setAnexos((atual) => atual.filter((_, i) => i !== index))}
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="manut-execucao-foot">
        <Btn type="submit" icon="check" disabled={busy}>
          {busy ? (anexos.length ? 'Enviando arquivos…' : 'Registrando…') : 'Registrar execução'}
        </Btn>
      </div>
    </form>
  );
}

export function ManutencaoPage() {
  const { condoId, session, cargoTipo, isGestaoTecnica } = useSession();
  const [rows, setRows] = useState([]);
  const [sistemasSalvos, setSistemasSalvos] = useState([]);
  const [subsistemasSalvos, setSubsistemasSalvos] = useState([]);
  const [avisoSistemas, setAvisoSistemas] = useState('');
  const [form, setForm] = useState({ sistema: '', sistemaNovo: '', periodicidade: 'mensal' });
  const [error, setError] = useState('');
  const { editable, editing, showEditButton, canRole, toggleEditing } = useEditTela('manage_catalog');
  const registra = podeRegistrar(cargoTipo, isGestaoTecnica);
  const ehMorador = String(cargoTipo || '').toLowerCase().trim() === 'morador';
  // Sistemas construtivos: lista padrão + salvos + os que já estão no cronograma.
  const sistemas = useMemo(() => {
    const mapa = new Map();
    function addNome(nome) {
      const texto = String(nome || '').trim();
      if (!texto) return;
      const chave = texto.toLocaleLowerCase('pt-BR');
      if (!mapa.has(chave)) mapa.set(chave, texto);
    }
    SUBSISTEMAS.forEach((item) => addNome(item.label));
    sistemasSalvos.forEach((nome) => addNome(nome));
    rows.forEach((row) => addNome(row.sistema));
    return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [sistemasSalvos, rows]);

  function subsistemasDe(sistema) {
    const chave = String(sistema || '').trim().toLocaleLowerCase('pt-BR');
    const nomes = new Map();
    subsistemasSalvos
      .filter((row) => String(row.sistema || '').trim().toLocaleLowerCase('pt-BR') === chave)
      .forEach((row) => {
        const k = String(row.nome || '').trim().toLocaleLowerCase('pt-BR');
        if (k && !nomes.has(k)) nomes.set(k, row.nome.trim());
      });
    return [...nomes.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  async function load() {
    const { data, error: err } = await supabase.from('manutencoes_preventivas').select('*').eq('condominio_id', condoId).order('proxima_execucao');
    if (err) setError(err.message);
    setRows(data || []);
    const salvos = await carregarSistemasManutencao(condoId);
    setSistemasSalvos(salvos.sistemas);
    setSubsistemasSalvos(salvos.subsistemas);
    setAvisoSistemas(salvos.aviso);
  }

  useEffect(() => {
    if (!condoId || ehMorador) return;
    load();
  }, [condoId, ehMorador]);

  async function criarSistemaConstrutivo(nome) {
    await supabase
      .from('manutencao_sistemas')
      .upsert({ condominio_id: condoId, nome }, { onConflict: 'condominio_id,nome', ignoreDuplicates: true });
    setSistemasSalvos((atual) => (atual.includes(nome) ? atual : [...atual, nome]));
    return nome;
  }

  async function criarSubsistema(sistema, nome) {
    await supabase
      .from('manutencao_subsistemas')
      .upsert({ condominio_id: condoId, sistema, nome }, { onConflict: 'condominio_id,sistema,nome', ignoreDuplicates: true });
    setSubsistemasSalvos((atual) => [...atual, { sistema, nome }]);
    return nome;
  }

  async function add(e) {
    e.preventDefault();
    setError('');
    const sistema = String(form.sistema === CRIAR_SISTEMA ? form.sistemaNovo : form.sistema).trim();
    if (!sistema) {
      setError('Informe o sistema da manutenção.');
      return;
    }
    const proxima = addPeriod(hoje(), form.periodicidade, form.periodicidade_dias);
    const payload = {
      condominio_id: condoId,
      sistema,
      periodicidade: form.periodicidade,
      responsavel_id: session.user.id,
      proxima_execucao: proxima,
      ativo: true,
    };

    const rpc = await supabase.rpc('criar_manutencao_preventiva', {
      p_condominio_id: payload.condominio_id,
      p_sistema: payload.sistema,
      p_tipo: null,
      p_periodicidade: payload.periodicidade,
      p_observacoes: null,
      p_proxima_execucao: payload.proxima_execucao,
    });
    const mensagemRpc = rpc.error?.message || '';
    const funcaoAusente = /could not find the function|schema cache|does not exist/i.test(mensagemRpc);
    if (!rpc.error) {
      setForm({ sistema: '', sistemaNovo: '', periodicidade: 'mensal' });
      load();
      return;
    }
    if (!funcaoAusente) {
      setError(/row-level security/i.test(mensagemRpc)
        ? 'Rode o arquivo supabase/manutencao-preventiva.sql no SQL Editor do Supabase e tente de novo.'
        : mensagemRpc);
      return;
    }

    const { error: err } = await supabase.from('manutencoes_preventivas').insert(payload, { returning: 'minimal' });
    if (err) {
      const bloqueio = /row-level security/i.test(err.message || '');
      setError(bloqueio
        ? 'Rode o arquivo supabase/manutencao-preventiva.sql no SQL Editor do Supabase e tente de novo.'
        : err.message);
    } else {
      setForm({ sistema: '', sistemaNovo: '', periodicidade: 'mensal' });
      load();
    }
  }

  if (ehMorador) return <Navigate to="/visao-geral" replace />;

  return (
    <Page
      title="Manutenção preventiva condominial"
      lead="Documento de referência e registro das execuções do condomínio."
      actions={(
        <>
          {registra ? <Btn to="/manutencao/relatorio" variant="ghost" icon="file">Relatório</Btn> : null}
          {showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
        </>
      )}
    >
      <Alert error={error} />
      {registra && avisoSistemas ? <p className="hint">{avisoSistemas}</p> : null}
      <DocumentosManutencao condoId={condoId} userId={session?.user?.id} podeAnexar={registra} />
      {registra ? (
        <RegistrarExecucao
          condoId={condoId}
          userId={session?.user?.id}
          sistemas={sistemas}
          subsistemasDe={subsistemasDe}
          onCriarSistema={criarSistemaConstrutivo}
          onCriarSubsistema={criarSubsistema}
          onRegistrado={load}
        />
      ) : null}

      {editable ? (
        <form className="panel stack" onSubmit={add} style={{ marginTop: 16 }}>
          <h2>Nova manutenção</h2>
          <Field label="Sistema">
            <select
              value={form.sistema}
              onChange={(e) => setForm({ ...form, sistema: e.target.value, sistemaNovo: '' })}
              required
            >
              <option value="">Selecione o sistema</option>
              {sistemas.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
              <option value={CRIAR_SISTEMA}>Criar sistema…</option>
            </select>
          </Field>
          {form.sistema === CRIAR_SISTEMA ? (
            <Field label="Nome do novo sistema">
              <input
                value={form.sistemaNovo}
                onChange={(e) => setForm({ ...form, sistemaNovo: e.target.value })}
                placeholder="Ex.: Elevadores"
                required
              />
            </Field>
          ) : null}
          <Field label="Periodicidade">
            <select value={form.periodicidade} onChange={(e) => setForm({ ...form, periodicidade: e.target.value })}>
              {Object.entries(PERIODICIDADE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Btn type="submit" icon="check">Salvar</Btn>
        </form>
      ) : !canRole && !registra ? (
        <p className="hint" style={{ marginTop: 16 }}>Somente leitura. A Gestão Técnica e o administrador cadastram as manutenções.</p>
      ) : null}
    </Page>
  );
}
