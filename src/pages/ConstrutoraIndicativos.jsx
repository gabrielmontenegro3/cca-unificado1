import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { resumoEspecificidades } from '../lib/especificidade';
import { GestaoBar } from '../components/GestaoBar';
import { EspecificidadeCarrossel } from '../components/Especificidade';
import { Alert, Empty, Page } from '../components/ui';

export function ConstrutoraIndicativosPage() {
  const { memberships } = useSession();
  const navigate = useNavigate();
  const [resumo, setResumo] = useState(null);
  const [error, setError] = useState('');

  const lista = useMemo(() => (memberships || [])
    .map((row) => ({
      id: row.condominio_id,
      nome: row.condominios?.nome || 'Condomínio',
    }))
    .filter((row) => row.id)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [memberships]);

  useEffect(() => {
    let live = true;
    const ids = lista.map((row) => row.id);
    if (!ids.length) {
      setResumo({});
      return undefined;
    }
    resumoEspecificidades(ids)
      .then((next) => {
        if (!live) return;
        setResumo(next);
        setError('');
      })
      .catch((err) => {
        if (!live) return;
        setError(err.message || 'Não foi possível carregar os indicativos.');
      });
    return () => { live = false; };
  }, [lista]);

  const slides = useMemo(() => (resumo ? lista.map((row) => ({
    id: row.id,
    nome: row.nome,
    resumo: resumo[row.id],
  })) : []), [lista, resumo]);

  return (
    <div className="portal">
      <GestaoBar variant="construtora" />
      <main className="portal-main wide">
        <Page
          title="Indicativos"
          lead="Local, subsistema e tipo de problema dos chamados, por condomínio."
        >
          <Alert error={error} />
          {!lista.length ? (
            <Empty text="Nenhum condomínio vinculado a esta construtora." />
          ) : !resumo ? (
            <p className="muted">{error ? '' : 'Carregando…'}</p>
          ) : (
            <EspecificidadeCarrossel
              slides={slides}
              onVerRelatorios={(condoId) => navigate(`/construtora-relatorios?condo=${condoId}`)}
            />
          )}
        </Page>
      </main>
    </div>
  );
}
