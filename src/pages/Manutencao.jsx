import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { PERIODICIDADE } from '../lib/permissions';
import { SUBSISTEMAS } from '../lib/especificidade';
import { iconForSistema } from '../lib/localIcon';
import { addPeriod, formatDate } from '../lib/format';
import { Alert, Btn, Empty, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { DetailFields, Modal } from '../components/DataList';
import { Icon } from '../components/icons';

const CRIAR_SISTEMA = '__criar__';

export function ManutencaoPage() {
  const { condoId, session } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ sistema: '', sistemaNovo: '', periodicidade: 'mensal' });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const { editable, editing, showEditButton, canRole, toggleEditing } = useEditTela('manage_catalog');
  const sistemas = useMemo(() => {
    const nomes = new Set(SUBSISTEMAS.map((item) => item.label));
    for (const row of rows) {
      const nome = String(row.sistema || '').trim();
      if (nome) nomes.add(nome);
    }
    return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [rows]);

  async function load() {
    const { data, error: err } = await supabase.from('manutencoes_preventivas').select('*').eq('condominio_id', condoId).order('proxima_execucao');
    if (err) setError(err.message);
    setRows(data || []);
  }
  useEffect(() => { if (condoId) load(); }, [condoId]);

  async function add(e) {
    e.preventDefault();
    setError('');
    const sistema = String(form.sistema === CRIAR_SISTEMA ? form.sistemaNovo : form.sistema).trim();
    if (!sistema) {
      setError('Informe o sistema da manutenção.');
      return;
    }
    const proxima = addPeriod(new Date().toISOString().slice(0, 10), form.periodicidade, form.periodicidade_dias);
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

  return (
    <Page
      title="Manutenção preventiva condominial"
      lead="Controle a periodicidade e a próxima data de cada sistema."
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={error} />
      {rows.length ? (
        <ul className="manut-grid">
          {rows.map((row) => {
            const periodo = PERIODICIDADE[row.periodicidade]?.label || row.periodicidade;
            return (
              <li key={row.id}>
                <button type="button" className="manut-card" onClick={() => setSelected(row)}>
                  <span className="manut-card-icon" aria-hidden="true">
                    <Icon name={iconForSistema(row.sistema)} size={22} />
                  </span>
                  <strong>{row.sistema}</strong>
                  <span>{periodo || 'Periodicidade não informada'}</span>
                  <span>{row.proxima_execucao ? formatDate(row.proxima_execucao) : 'Sem data'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty text="Nenhuma manutenção." />
      )}
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
      ) : !canRole ? (
        <p className="hint" style={{ marginTop: 16 }}>Somente leitura. A Gestão Técnica e o administrador cadastram as manutenções.</p>
      ) : null}

      <Modal
        open={Boolean(selected)}
        title={selected?.sistema || 'Manutenção'}
        onClose={() => setSelected(null)}
      >
        <DetailFields
          fields={[
            { label: 'Sistema', value: selected?.sistema },
            { label: 'Periodicidade', value: PERIODICIDADE[selected?.periodicidade]?.label || selected?.periodicidade },
            { label: 'Próxima execução', value: formatDate(selected?.proxima_execucao) },
          ]}
        />
      </Modal>
    </Page>
  );
}
