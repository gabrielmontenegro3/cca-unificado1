import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { PERIODICIDADE, can } from '../lib/permissions';
import { addPeriod, formatDate, maintenanceTone } from '../lib/format';
import { Alert, Badge, Btn, Empty, Field, Page } from '../components/ui';

export function ManutencaoPage() {
  const { condoId, session, cargoTipo } = useSession();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ sistema: '', tipo: '', periodicidade: 'mensal', observacoes: '' });
  const [error, setError] = useState('');
  const editable = can(cargoTipo, 'manage_catalog');

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
    load();
  }

  return (
    <Page title="Manutenção preventiva" lead="O histórico fica em manutencao_execucoes; a listagem só destaca a próxima data.">
      <Alert error={error} />
      <div className="table-wrap panel">
        {!rows.length ? <Empty text="Nenhuma manutenção." /> : (
          <table>
            <thead><tr><th>Sistema</th><th>Periodicidade</th><th>Próxima</th><th>Status</th>{editable ? <th></th> : null}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.sistema}</td>
                  <td>{PERIODICIDADE[row.periodicidade]?.label}</td>
                  <td>{formatDate(row.proxima_execucao)}</td>
                  <td><Badge value={maintenanceTone(row)} /></td>
                  {editable ? (
                    <td><Btn variant="ghost" icon="check" onClick={() => executar(row)}>Registrar execução</Btn></td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
      ) : (
        <p className="hint" style={{ marginTop: 16 }}>Somente leitura. A Gestão Técnica e o administrador cadastram as manutenções.</p>
      )}
    </Page>
  );
}
