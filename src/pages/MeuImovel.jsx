import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { arquivoEhImagem, publicOrSignedUrl } from '../lib/api';
import { fichaPreenchida, textosPreenchidos } from '../lib/tipoApto';
import { Alert, Btn, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';

function mensagemErro(err) {
  const msg = String(err?.message || err || '');
  if (/meu_imovel_secoes|tipo_apartamento_secoes|schema cache|does not exist|42P01/i.test(msg)) {
    return 'Rode o arquivo supabase/meu-imovel.sql no SQL Editor do Supabase e tente de novo.';
  }
  return msg || 'Não foi possível concluir.';
}

async function urlDaPlanta(arquivo) {
  if (!arquivo?.storage_path || !arquivoEhImagem(arquivo)) return '';
  const { data } = await publicOrSignedUrl(arquivo.storage_path);
  return data?.signedUrl || '';
}

function SecaoGuia({ secao, aberta, onToggle, onExcluir }) {
  return (
    <article className={`meu-imovel-secao${aberta ? ' is-open' : ''}`}>
      <button type="button" className="meu-imovel-secao-toggle" onClick={onToggle} aria-expanded={aberta}>
        <h2>{secao.titulo}</h2>
        <span className="meu-imovel-secao-action">{aberta ? 'Ver menos' : 'Ver mais'}</span>
      </button>
      {aberta ? (
        <div className="meu-imovel-secao-body">
          <p>{secao.texto}</p>
          {onExcluir ? (
            <Btn type="button" variant="ghost" icon="x" onClick={onExcluir}>Excluir seção</Btn>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function MeuImovelPage() {
  const { condoId, session } = useSession();
  const [secoes, setSecoes] = useState([]);
  const [tipo, setTipo] = useState(null);
  const [abertas, setAbertas] = useState({});
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ titulo: '', texto: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { editable, editing, showEditButton, toggleEditing } = useEditTela('manage_content');

  async function load() {
    if (!condoId) return;
    setError('');
    const guia = await supabase
      .from('meu_imovel_secoes')
      .select('id, titulo, texto, ordem')
      .eq('condominio_id', condoId)
      .order('ordem');
    if (guia.error) {
      setError(mensagemErro(guia.error));
      setSecoes([]);
    } else {
      setSecoes(guia.data || []);
    }

    const userId = session?.user?.id;
    if (!userId) {
      setTipo(null);
      return;
    }
    const vinculo = await supabase
      .from('usuario_condominio')
      .select('tipo_apartamento_id')
      .eq('condominio_id', condoId)
      .eq('usuario_id', userId)
      .maybeSingle();
    const tipoId = vinculo.data?.tipo_apartamento_id;
    if (!tipoId) {
      setTipo(null);
      return;
    }
    const [tipoRes, secoesRes] = await Promise.all([
      supabase.from('tipos_apartamento').select('*').eq('id', tipoId).maybeSingle(),
      supabase.from('tipo_apartamento_secoes').select('id, titulo, texto, ordem').eq('tipo_id', tipoId).order('ordem'),
    ]);
    if (tipoRes.error) {
      setError(mensagemErro(tipoRes.error));
      setTipo(null);
      return;
    }
    let plantaUrl = '';
    if (tipoRes.data?.planta_arquivo_id) {
      const arquivo = await supabase.from('arquivos').select('*').eq('id', tipoRes.data.planta_arquivo_id).maybeSingle();
      plantaUrl = await urlDaPlanta(arquivo.data);
    }
    setTipo({
      ...(tipoRes.data || {}),
      plantaUrl,
      secoes: secoesRes.data || [],
    });
  }

  useEffect(() => { load(); }, [condoId, session?.user?.id]);

  const cardsTipo = useMemo(() => (tipo?.secoes || []).map((secao) => ({
    ...secao,
    key: `tipo-${secao.id}`,
  })), [tipo]);
  const cardsCondo = useMemo(() => secoes.map((secao) => ({
    ...secao,
    key: secao.id,
  })), [secoes]);

  const query = q.trim().toLowerCase();
  function bate(secao) {
    return `${secao.titulo} ${secao.texto}`.toLowerCase().includes(query);
  }
  const tipoVisivel = tipo && (!query || [
    tipo.nome,
    ...fichaPreenchida(tipo).map((item) => `${item.label} ${tipo[item.key]}`),
    ...textosPreenchidos(tipo).map((item) => tipo[item.key]),
    ...cardsTipo.map((secao) => `${secao.titulo} ${secao.texto}`),
  ].join(' ').toLowerCase().includes(query));
  const secoesTipo = query ? cardsTipo.filter(bate) : cardsTipo;
  const secoesCondo = query ? cardsCondo.filter(bate) : cardsCondo;
  const vazio = !tipoVisivel && !secoesTipo.length && !secoesCondo.length;

  function toggle(id) {
    setAbertas((prev) => ({ ...prev, [id]: prev[id] === false }));
  }

  async function criarSecao(e) {
    e.preventDefault();
    const titulo = form.titulo.trim();
    const texto = form.texto.trim();
    if (!titulo || !texto) {
      setError('Informe o título e o subtítulo.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: err } = await supabase.from('meu_imovel_secoes').insert({
      condominio_id: condoId,
      titulo,
      texto,
      ordem: secoes.length,
    });
    setBusy(false);
    if (err) {
      setError(mensagemErro(err));
      return;
    }
    setForm({ titulo: '', texto: '' });
    load();
  }

  async function excluirSecao(id) {
    if (!window.confirm('Excluir esta seção?')) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.from('meu_imovel_secoes').delete().eq('id', id);
    setBusy(false);
    if (err) {
      setError(mensagemErro(err));
      return;
    }
    load();
  }

  const ficha = fichaPreenchida(tipo);
  const textos = textosPreenchidos(tipo);

  return (
    <Page
      title="Meu imóvel"
      lead="A planta e a ficha do seu tipo de apartamento, com as orientações deste condomínio."
      className="page-meu-imovel"
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
      search={{
        value: q,
        onChange: setQ,
        placeholder: 'Buscar no Meu imóvel…',
      }}
    >
      <Alert error={error} />
      <div className="meu-imovel-stack">
        {tipoVisivel ? (
          <article className="meu-imovel-tipo">
            {tipo.plantaUrl ? (
              <img className="meu-imovel-planta" src={tipo.plantaUrl} alt={`Planta do tipo ${tipo.nome}`} />
            ) : null}
            <header className="meu-imovel-tipo-head">
              <p>Tipo de apartamento</p>
              <h2>{tipo.nome}</h2>
            </header>
            {ficha.length ? (
              <dl className="meu-imovel-ficha">
                {ficha.map((item) => (
                  <div key={item.key}>
                    <dt>{item.label}</dt>
                    <dd>{tipo[item.key]}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {textos.map((item) => (
              <div key={item.key} className="meu-imovel-texto">
                <h3>{item.label}</h3>
                <p>{tipo[item.key]}</p>
              </div>
            ))}
          </article>
        ) : null}

        {vazio ? (
          <p className="meu-imovel-empty">
            {query ? `Nenhum resultado para “${q.trim()}”.` : 'Nenhuma informação cadastrada ainda.'}
          </p>
        ) : null}

        {secoesTipo.map((secao) => (
          <SecaoGuia
            key={secao.key}
            secao={secao}
            aberta={abertas[secao.key] !== false}
            onToggle={() => toggle(secao.key)}
          />
        ))}
        {secoesCondo.map((secao) => (
          <SecaoGuia
            key={secao.key}
            secao={secao}
            aberta={abertas[secao.key] !== false}
            onToggle={() => toggle(secao.key)}
            onExcluir={editable ? () => excluirSecao(secao.id) : null}
          />
        ))}
      </div>

      {editable ? (
        <form className="panel stack" onSubmit={criarSecao} style={{ marginTop: 16 }}>
          <h2>Nova seção deste condomínio</h2>
          <Field label="Título">
            <input
              value={form.titulo}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              placeholder="Ex.: Recebimento do imóvel"
              required
            />
          </Field>
          <Field label="Subtítulo">
            <textarea
              value={form.texto}
              onChange={(e) => setForm({ ...form, texto: e.target.value })}
              rows={4}
              placeholder="Texto desta seção"
              required
            />
          </Field>
          <Btn type="submit" icon="plus" disabled={busy}>{busy ? 'Salvando…' : 'Adicionar seção'}</Btn>
        </form>
      ) : null}
    </Page>
  );
}
