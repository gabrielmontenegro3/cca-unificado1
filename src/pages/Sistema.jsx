import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { formatDateTime } from '../lib/format';
import {
  NOTIF_TIPO_LABEL,
  destinoNotificacao,
  listarNotificacoes,
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
} from '../lib/notifications';
import {
  aplicarPrefs,
  DEFAULT_PREFS,
  prefsDoPerfil,
} from '../lib/prefs';
import { Alert, AppLogo, Btn, Empty, Page } from '../components/ui';
import { GestaoBar } from '../components/GestaoBar';
import { PreferenciasForm } from '../components/PreferenciasUI';

function usePreferenciasEditor({ firstAccess = false } = {}) {
  const { profile, savePreferencias } = useSession();
  const initial = prefsDoPerfil(profile) || DEFAULT_PREFS;
  const [tema, setTema] = useState(initial.tema);
  const [tamanhoFonte, setTamanhoFonte] = useState(initial.tamanho_fonte);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    const next = prefsDoPerfil(profile) || DEFAULT_PREFS;
    setTema(next.tema);
    setTamanhoFonte(next.tamanho_fonte);
  }, [profile?.id, profile?.tema, profile?.tamanho_fonte, profile?.preferencias_ok]);

  function escolherTema(value) {
    setTema(value);
    setOk('');
    aplicarPrefs({ tema: value, tamanho_fonte: tamanhoFonte });
  }

  function escolherFonte(value) {
    setTamanhoFonte(value);
    setOk('');
    aplicarPrefs({ tema, tamanho_fonte: value });
  }

  async function salvar() {
    setBusy(true);
    setError('');
    setOk('');
    try {
      await savePreferencias({ tema, tamanho_fonte: tamanhoFonte });
      if (!firstAccess) setOk('Preferências salvas.');
    } catch (err) {
      const msg = err?.message || '';
      setError(
        /preferencias|tema|tamanho_fonte|PGRST204|column/i.test(msg)
          ? 'Não foi possível salvar. Rode o SQL preferencias-usuario.sql no Supabase.'
          : (msg || 'Não foi possível salvar as preferências.')
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    tema,
    tamanhoFonte,
    busy,
    error,
    ok,
    escolherTema,
    escolherFonte,
    salvar,
  };
}

export function OnboardingPreferencias() {
  const { branding, condo, isGestaoTecnica } = useSession();
  const editor = usePreferenciasEditor({ firstAccess: true });
  const condoNome = branding?.nome || condo?.nome;

  return (
    <div className="prefs-onboarding">
      <div className="prefs-onboarding-card">
        {branding?.logo ? (
          <img className="prefs-onboarding-logo" src={branding.logo} alt={condoNome || 'Logo'} />
        ) : (
          <AppLogo className="prefs-onboarding-logo" />
        )}
        <h1>{condoNome ? `Bem-vindo a ${condoNome}` : 'Bem-vindo ao CCA'}</h1>
        <p className="prefs-onboarding-lead">
          {isGestaoTecnica
            ? 'Antes de começar, escolha o tamanho das letras e o tema claro ou escuro. Você pode mudar depois em Configurações.'
            : 'Este é o seu primeiro acesso ao portal do condomínio. Escolha o tamanho das letras e o tema claro ou escuro. Você pode alterar depois em Sistema → Configurações.'}
        </p>
        <PreferenciasForm
          tema={editor.tema}
          tamanhoFonte={editor.tamanhoFonte}
          onTema={editor.escolherTema}
          onFonte={editor.escolherFonte}
          onSubmit={editor.salvar}
          busy={editor.busy}
          error={editor.error}
          submitLabel="Entrar no sistema"
        />
      </div>
    </div>
  );
}

export function ConfiguracoesPage() {
  const { isGestaoTecnica, condoId } = useSession();
  const editor = usePreferenciasEditor();

  const body = (
    <Page
      title="Configurações"
      lead="Ajuste o tamanho das letras e o tema claro ou escuro da sua conta."
    >
      <PreferenciasForm
        tema={editor.tema}
        tamanhoFonte={editor.tamanhoFonte}
        onTema={editor.escolherTema}
        onFonte={editor.escolherFonte}
        onSubmit={editor.salvar}
        busy={editor.busy}
        error={editor.error}
        ok={editor.ok}
        submitLabel="Salvar preferências"
      />
    </Page>
  );

  if (isGestaoTecnica && !condoId) {
    return (
      <div className="portal">
        <GestaoBar />
        <main className="portal-main wide">{body}</main>
      </div>
    );
  }

  return body;
}

export function NotificacoesPage() {
  const { condoId, selectCondo, isGestaoTecnica } = useSession();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await listarNotificacoes({
        condominioId: (!isGestaoTecnica || condoId) ? condoId : undefined,
      }));
    } catch (err) {
      setError(err.message || 'Não foi possível carregar as notificações. Rode o SQL notificacoes.sql no Supabase.');
    }
  }

  useEffect(() => { load(); }, [condoId, isGestaoTecnica]);

  async function abrir(row) {
    setBusy(true);
    try {
      await marcarNotificacaoLida(row.id);
      await destinoNotificacao(row, { selectCondo, navigate, isGestaoTecnica });
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível abrir a notificação.');
    } finally {
      setBusy(false);
    }
  }

  async function marcarTodas() {
    setBusy(true);
    try {
      await marcarTodasNotificacoesLidas();
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível marcar como lidas.');
    } finally {
      setBusy(false);
    }
  }

  const naoLidas = rows.filter((r) => !r.lida_em).length;

  const body = (
    <Page
      title="Notificações"
      lead="Avisos de conversas, boletins e mudanças nos seus chamados."
      actions={naoLidas ? (
        <Btn variant="ghost" disabled={busy} onClick={marcarTodas}>Marcar todas como lidas</Btn>
      ) : null}
    >
      <Alert error={error} />
      {!rows.length ? (
        <Empty text="Nenhuma notificação ainda." />
      ) : (
        <ul className="data-list notif-list">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={`data-list-item notif-item${!row.lida_em ? ' unread' : ''}`}
                onClick={() => abrir(row)}
                disabled={busy}
              >
                <span className="data-list-main">
                  <strong>{row.titulo}</strong>
                  <span className="data-list-sub">
                    {[NOTIF_TIPO_LABEL[row.tipo] || row.tipo, row.corpo, formatDateTime(row.created_at)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {!row.lida_em ? <span className="notif-dot" aria-label="Não lida" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );

  if (isGestaoTecnica && !condoId) {
    return (
      <div className="portal">
        <GestaoBar />
        <main className="portal-main wide">{body}</main>
      </div>
    );
  }

  return body;
}
