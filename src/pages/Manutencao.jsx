import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { PERIODICIDADE } from '../lib/permissions';
import { addPeriod, formatDate, maintenanceTone } from '../lib/format';
import { Alert, Badge, Btn, Field, Page } from '../components/ui';
import { EditTelaButton, useEditTela } from '../components/EditTela';
import { DataList, DetailFields, Modal } from '../components/DataList';

export function ManutencaoPage() {
  const { condoId, session } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ sistema: '', tipo: '', periodicidade: 'mensal', observacoes: '' });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const { editable, editing, showEditButton, canRole, toggleEditing } = useEditTela('manage_catalog');

  async function load() {
    const { data, error: err } = await supabase.from('manutencoes_preventivas').select('*, usuarios:responsavel_id(nome)').eq('condominio_id', condoId).order('proxima_execucao');
    if (err) setError(err.message);
    setRows(data || []);
  }
  useEffect(() => { if (condoId) load(); }, [condoId]);

  async function add(e) {
    e.preventDefault();
    setError('');
    const proxima = addPeriod(new Date().toISOString().slice(0, 10), form.periodicidade, form.periodicidade_dias);
    const payload = {
      condominio_id: condoId,
      sistema: String(form.sistema || '').trim(),
      periodicidade: form.periodicidade,
      observacoes: form.observacoes || null,
      responsavel_id: session.user.id,
      proxima_execucao: proxima,
      ativo: true,
    };
    if (String(form.tipo || '').trim()) payload.tipo = String(form.tipo).trim();

    const rpc = await supabase.rpc('criar_manutencao_preventiva', {
      p_condominio_id: payload.condominio_id,
      p_sistema: payload.sistema,
      p_tipo: payload.tipo || null,
      p_periodicidade: payload.periodicidade,
      p_observacoes: payload.observacoes,
      p_proxima_execucao: payload.proxima_execucao,
    });
    if (!rpc.error) {
      setForm({ sistema: '', tipo: '', periodicidade: 'mensal', observacoes: '' });
      load();
      return;
    }

    const { error: err } = await supabase.from('manutencoes_preventivas').insert(payload);
    if (err) setError(err.message || rpc.error.message);
    else {
      setForm({ sistema: '', tipo: '', periodicidade: 'mensal', observacoes: '' });
      load();
    }
  }

  async function executar(row) {
    const hoje = new Date().toISOString().slice(0, 10);
    const { error: execErr } = await supabase.from('manutencao_execucoes').insert({
      manutencao_id: row.id,
      executado_por: session.user.id,
      data_execucao: hoje,
    });
    if (execErr) return setError(execErr.message);
    const proxima = addPeriod(hoje, row.periodicidade, row.periodicidade_dias);
    await supabase.from('manutencoes_preventivas').update({
      ultima_execucao: hoje,
      proxima_execucao: proxima,
    }).eq('id', row.id);
    setSelected(null);
    load();
  }

  return (
    <Page
      title="Manutenção preventiva"
      lead="O histórico fica em manutencao_execucoes; a listagem só destaca a próxima data."
      actions={showEditButton ? <EditTelaButton editing={editing} onToggle={toggleEditing} /> : null}
    >
      <Alert error={error} />
      <DataList
        rows={rows}
        empty="Nenhuma manutenção."
        getTitle={(row) => row.sistema}
        getSubtitle={(row) => [
          PERIODICIDADE[row.periodicidade]?.label,
          `Próxima ${formatDate(row.proxima_execucao)}`,
          String(maintenanceTone(row) || '').replaceAll('_', ' '),
        ].filter(Boolean).join(' · ')}
        onSelect={setSelected}
      />
      {editable ? (
        <form className="panel stack" onSubmit={add} style={{ marginTop: 16 }}>
          <h2>Nova manutenção</h2>
          <Field label="Sistema"><input value={form.sistema} onChange={(e) => setForm({ ...form, sistema: e.target.value })} required /></Field>
          <Field label="Tipo"><input value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} /></Field>
          <Field label="Periodicidade">
            <select value={form.periodicidade} onChange={(e) => setForm({ ...form, periodicidade: e.target.value })}>
              {Object.entries(PERIODICIDADE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Observações"><textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></Field>
          <Btn type="submit" icon="check">Salvar</Btn>
        </form>
      ) : !canRole ? (
        <p className="hint" style={{ marginTop: 16 }}>Somente leitura. A Gestão Técnica e o administrador cadastram as manutenções.</p>
      ) : null}

      <Modal
        open={Boolean(selected)}
        title={selected?.sistema || 'Manutenção'}
        onClose={() => setSelected(null)}
        footer={editable && selected ? (
          <Btn icon="check" onClick={() => executar(selected)}>Registrar execução</Btn>
        ) : null}
      >
        <DetailFields
          fields={[
            { label: 'Sistema', value: selected?.sistema },
            { label: 'Tipo', value: selected?.tipo || '—' },
            { label: 'Periodicidade', value: PERIODICIDADE[selected?.periodicidade]?.label || selected?.periodicidade },
            { label: 'Próxima execução', value: formatDate(selected?.proxima_execucao) },
            { label: 'Última execução', value: formatDate(selected?.ultima_execucao) },
            { label: 'Status', value: <Badge value={maintenanceTone(selected)} /> },
            { label: 'Responsável', value: selected?.usuarios?.nome || '—' },
            { label: 'Observações', value: selected?.observacoes || '—' },
          ]}
        />
      </Modal>
    </Page>
  );
}
