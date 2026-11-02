import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { arquivoEhImagem, publicOrSignedUrl, uploadArquivo } from '../lib/api';
import { FICHA_TIPO_APTO, TEXTOS_TIPO_APTO, fichaPreenchida, fichaVazia, textosPreenchidos } from '../lib/tipoApto';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { Modal } from '../components/DataList';
import { Icon } from '../components/icons';

const SECAO_VAZIA = { titulo: '', texto: '' };

function mensagemErro(err) {
  const msg = String(err?.message || err || '');
  if (/tipos_apartamento|tipo_apartamento_secoes|planta_arquivo|schema cache|does not exist|42P01|PGRST204/i.test(msg)) {
    return 'Rode os arquivos supabase/tipos-apartamento.sql e supabase/meu-imovel.sql no SQL Editor do Supabase e tente de novo.';
  }
  return msg || 'Não foi possível concluir.';
}

async function comUrl(arquivo) {
  if (!arquivo?.storage_path || !arquivoEhImagem(arquivo)) return arquivo;
  const { data } = await publicOrSignedUrl(arquivo.storage_path);
  return { ...arquivo, url: data?.signedUrl || '' };
}

function arquivosDoTipo(row) {
  return (row?.tipo_apartamento_arquivos || [])
    .slice()
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .map((item) => (item.arquivos ? { ...item.arquivos, vinculoId: item.id } : null))
    .filter(Boolean);
}

export function TipoAptoPage() {
  const { condoId, session } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ nome: '', ...fichaVazia(), planta: null, files: [], secoes: [{ ...SECAO_VAZIA }] });
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [extraFiles, setExtraFiles] = useState([]);
  const { editable, editing, showEditButton, toggleEditing } = useEditTela('manage_content');

  async function load() {
    const { data, error: err } = await supabase
      .from('tipos_apartamento')
      .select('*, tipo_apartamento_arquivos(id, ordem, arquivos(*)), tipo_apartamento_secoes(id, titulo, texto, ordem)')
      .eq('condominio_id', condoId)
      .order('ordem');
    if (err) {
      setError(mensagemErro(err));
      setRows([]);
      return;
    }
    const plantasIds = [...new Set((data || []).map((row) => row.planta_arquivo_id).filter(Boolean))];
    const plantasRes = plantasIds.length
      ? await supabase.from('arquivos').select('*').in('id', plantasIds)
      : { data: [] };
    const plantas = Object.fromEntries(await Promise.all((plantasRes.data || []).map(async (arquivo) => {
      const comImagem = await comUrl(arquivo);
      return [arquivo.id, comImagem];
    })));
    const lista = await Promise.all((data || []).map(async (row) => {
      const arquivos = await Promise.all(arquivosDoTipo(row).map(comUrl));
      const secoes = (row.tipo_apartamento_secoes || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      return { ...row, arquivos, secoes, planta: plantas[row.planta_arquivo_id] || null };
    }));
    setRows(lista);
    setSelected((atual) => (atual ? lista.find((row) => row.id === atual.id) || null : null));
  }

  useEffect(() => { if (condoId) load(); }, [condoId]);

  async function anexar(tipoId, files, ordemInicial) {
    const lista = [...(files || [])];
    for (let index = 0; index < lista.length; index += 1) {
      const arquivo = await uploadArquivo({
        condominioId: condoId,
        userId: session.user.id,
        file: lista[index],
        folder: 'tipos-apartamento',
      });
      const { error: err } = await supabase.from('tipo_apartamento_arquivos').insert({
        tipo_id: tipoId,
        arquivo_id: arquivo.id,
        ordem: ordemInicial + index,
      });
      if (err) throw err;
    }
  }

  async function add(e) {
    e.preventDefault();
    const nome = form.nome.trim();
    if (!nome) {
      setError('Informe o tipo do apartamento, por exemplo A, B ou C.');
      return;
    }
    if (!form.planta || !String(form.planta.type || '').startsWith('image/')) {
      setError('Inclua a planta ou uma imagem que destaque este tipo.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const ficha = Object.fromEntries(
        [...FICHA_TIPO_APTO, ...TEXTOS_TIPO_APTO].map((item) => [item.key, String(form[item.key] || '').trim()]),
      );
      const { data, error: err } = await supabase
        .from('tipos_apartamento')
        .insert({
          condominio_id: condoId,
          nome,
          ordem: rows.length,
          ...ficha,
        })
        .select('id')
        .single();
      if (err) throw err;
      const planta = await uploadArquivo({
        condominioId: condoId,
        userId: session.user.id,
        file: form.planta,
        folder: 'tipos-apartamento',
      });
      const { error: plantaErr } = await supabase
        .from('tipos_apartamento')
        .update({ planta_arquivo_id: planta.id })
        .eq('id', data.id);
      if (plantaErr) throw plantaErr;
      const { error: vinculoErr } = await supabase.from('tipo_apartamento_arquivos').insert({
        tipo_id: data.id,
        arquivo_id: planta.id,
        ordem: 0,
      });
      if (vinculoErr) throw vinculoErr;
      if (form.files.length) await anexar(data.id, form.files, 1);
      const secoes = form.secoes
        .map((secao) => ({ titulo: secao.titulo.trim(), texto: secao.texto.trim() }))
        .filter((secao) => secao.titulo && secao.texto);
      if (secoes.length) {
        const { error: secErr } = await supabase.from('tipo_apartamento_secoes').insert(
          secoes.map((secao, index) => ({ tipo_id: data.id, ...secao, ordem: index })),
        );
        if (secErr) throw secErr;
      }
      setForm({ nome: '', ...fichaVazia(), planta: null, files: [], secoes: [{ ...SECAO_VAZIA }] });
      setFormKey((value) => value + 1);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function adicionarNoTipo(e) {
    e.preventDefault();
    if (!selected || !extraFiles.length) return;
    setBusy(true);
    setError('');
    try {
      await anexar(selected.id, extraFiles, selected.arquivos?.length || 0);
      setExtraFiles([]);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function excluirArquivo(arquivo) {
    if (!selected || !arquivo?.vinculoId) return;
    setBusy(true);
    setError('');
    try {
      const { error: err } = await supabase.from('tipo_apartamento_arquivos').delete().eq('id', arquivo.vinculoId);
      if (err) throw err;
      if (arquivo.id) await supabase.from('arquivos').delete().eq('id', arquivo.id);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function excluirTipo(row) {
    if (!row?.id) return;
    if (!window.confirm(`Excluir o tipo ${row.nome}?`)) return;
    setBusy(true);
    setError('');
    try {
      const { error: err } = await supabase.from('tipos_apartamento').delete().eq('id', row.id);
      if (err) throw err;
      for (const arquivo of row.arquivos || []) {
        if (arquivo.id) await supabase.from('arquivos').delete().eq('id', arquivo.id);
      }
      setSelected(null);
      await load();
    } catch (err) {
      setError(mensagemErro(err));
    } finally {
      setBusy(false);
    }
  }

  async function baixar(arquivo) {
    if (!arquivo?.storage_path) return;
    const { data, error: err } = await publicOrSignedUrl(arquivo.storage_path);
    if (err || !data?.signedUrl) {
      setError(err?.message || 'Não foi possível abrir o arquivo.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  const aberto = selected ? rows.find((row) => row.id === selected.id) || selected : null;
  const outrosArquivos = (aberto?.arquivos || []).filter((arquivo) => arquivo.id !== aberto?.planta_arquivo_id);

  return (
    <Page
      title="Tipo Apto"
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={error} />

      {!rows.length ? (
        <Empty text="Nenhum tipo de apartamento ainda." />
      ) : (
        <ul className="tipo-apto-grid">
          {rows.map((row) => {
            const capa = row.planta?.url ? row.planta : (row.arquivos || []).find((arquivo) => arquivo.url);
            const total = row.arquivos?.length || 0;
            return (
              <li key={row.id}>
                <button type="button" className="tipo-apto-card" onClick={() => setSelected(row)}>
                  <span className="tipo-apto-cover">
                    {capa ? <img src={capa.url} alt="" /> : <strong>{row.nome}</strong>}
                  </span>
                  <span className="tipo-apto-copy">
                    <strong>{row.nome}</strong>
                    <small>{row.descricao || 'Sem descrição'}</small>
                    <em>{total === 1 ? '1 arquivo' : `${total} arquivos`}</em>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editable ? (
        <form className="panel stack tipo-apto-form" onSubmit={add}>
          <h2>Novo tipo</h2>
          <Field label="Tipo">
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="A, B, C, D…"
              required
            />
          </Field>
          <div className="tipo-apto-ficha">
            {FICHA_TIPO_APTO.map((item) => (
              <Field key={item.key} label={item.label}>
                <input
                  value={form[item.key]}
                  placeholder={item.placeholder}
                  onChange={(e) => setForm({ ...form, [item.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          {TEXTOS_TIPO_APTO.map((item) => (
            <Field key={item.key} label={item.label}>
              <textarea
                value={form[item.key]}
                placeholder={item.placeholder}
                rows={3}
                onChange={(e) => setForm({ ...form, [item.key]: e.target.value })}
              />
            </Field>
          ))}
          <Field label="Planta ou imagem de destaque">
            <input
              key={`planta-${formKey}`}
              type="file"
              accept="image/*"
              required
              onChange={(e) => setForm({ ...form, planta: e.target.files?.[0] || null })}
            />
          </Field>
          <div className="stack">
            <h3>Seções no Meu imóvel</h3>
            {form.secoes.map((secao, index) => (
              <div key={index} className="tipo-apto-secao">
                <Field label="Título">
                  <input
                    value={secao.titulo}
                    placeholder="Ex.: Sala e cozinha"
                    onChange={(e) => {
                      const secoes = form.secoes.map((item, i) => (i === index ? { ...item, titulo: e.target.value } : item));
                      setForm({ ...form, secoes });
                    }}
                  />
                </Field>
                <Field label="Subtítulo">
                  <textarea
                    value={secao.texto}
                    rows={3}
                    placeholder="Texto desta seção"
                    onChange={(e) => {
                      const secoes = form.secoes.map((item, i) => (i === index ? { ...item, texto: e.target.value } : item));
                      setForm({ ...form, secoes });
                    }}
                  />
                </Field>
              </div>
            ))}
            <Btn
              type="button"
              variant="ghost"
              icon="plus"
              onClick={() => setForm({ ...form, secoes: [...form.secoes, { ...SECAO_VAZIA }] })}
            >
              Adicionar título e subtítulo
            </Btn>
          </div>
          <Field label="Outros arquivos">
            <input
              key={formKey}
              type="file"
              multiple
              onChange={(e) => setForm({ ...form, files: [...(e.target.files || [])] })}
            />
          </Field>
          <Btn type="submit" icon="plus" disabled={busy}>
            {busy ? 'Salvando…' : 'Adicionar tipo'}
          </Btn>
        </form>
      ) : null}

      <Modal
        open={Boolean(aberto)}
        title={aberto ? `Tipo ${aberto.nome}` : 'Tipo'}
        onClose={() => { setSelected(null); setExtraFiles([]); }}
        footer={editable && aberto ? (
          <Btn variant="danger" icon="x" disabled={busy} onClick={() => excluirTipo(aberto)}>
            Excluir tipo
          </Btn>
        ) : null}
      >
        {aberto ? (
          <div className="stack">
            {aberto.planta?.url ? <img className="meu-imovel-planta" src={aberto.planta.url} alt="" /> : null}
            {fichaPreenchida(aberto).length ? (
              <dl className="meu-imovel-ficha">
                {fichaPreenchida(aberto).map((item) => (
                  <div key={item.key}>
                    <dt>{item.label}</dt>
                    <dd>{aberto[item.key]}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {textosPreenchidos(aberto).map((item) => (
              <div key={item.key} className="meu-imovel-texto">
                <h3>{item.label}</h3>
                <p>{aberto[item.key]}</p>
              </div>
            ))}
            {(aberto.secoes || []).map((secao) => (
              <article key={secao.id} className="meu-imovel-secao is-open">
                <div className="meu-imovel-secao-toggle">
                  <h2>{secao.titulo}</h2>
                </div>
                <div className="meu-imovel-secao-body">
                  <p>{secao.texto}</p>
                </div>
              </article>
            ))}
            {outrosArquivos.length ? (
              <ul className="tipo-apto-files">
                {outrosArquivos.map((arquivo) => (
                  <li key={arquivo.vinculoId || arquivo.id} className="tipo-apto-file">
                    {arquivo.url ? (
                      <img src={arquivo.url} alt="" />
                    ) : (
                      <span className="tipo-apto-file-icon" aria-hidden="true">
                        <Icon name="file" size={28} />
                      </span>
                    )}
                    <strong>{arquivo.nome_original || 'Arquivo'}</strong>
                    <div className="tipo-apto-file-actions">
                      <Btn variant="ghost" icon="download" onClick={() => baixar(arquivo)}>Abrir</Btn>
                      {editable ? (
                        <Btn variant="ghost" icon="x" disabled={busy} onClick={() => excluirArquivo(arquivo)}>
                          Remover
                        </Btn>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {editable ? (
              <form className="stack" onSubmit={adicionarNoTipo}>
                <Field label="Incluir fotos ou arquivos">
                  <input
                    type="file"
                    multiple
                    onChange={(e) => setExtraFiles([...(e.target.files || [])])}
                  />
                </Field>
                <Btn type="submit" icon="paperclip" disabled={busy || !extraFiles.length}>
                  Anexar
                </Btn>
              </form>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </Page>
  );
}
