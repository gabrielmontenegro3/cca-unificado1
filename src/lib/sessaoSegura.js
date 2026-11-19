/**
 * Proteção contra "JWT expired" (login vencido).
 *
 * 1) Se o servidor responder que o login venceu, pede uma credencial nova direto ao servidor
 *    (sem confiar no relógio do computador) e repete a requisição. O usuário não percebe nada.
 * 2) Se não der para renovar (sessão encerrada, senha trocada…), sai do sistema e a tela de
 *    login mostra "Sua sessão expirou. Entre novamente."
 * 3) Compara o relógio do computador com a hora em que o servidor emitiu a credencial;
 *    se a diferença for grande, avisa o usuário para ajustar data e hora.
 */

export const CHAVE_SESSAO_EXPIRADA = 'cca.sessaoExpirada';

/** Diferença tolerada entre o relógio do computador e o do servidor. */
const TOLERANCIA_RELOGIO_S = 120;

let cliente = null;
let renovando = null;
let diferencaRelogioS = 0;
const ouvintesRelogio = new Set();

/** Liga a proteção ao cliente do Supabase (chamado uma vez, ao criar o cliente). */
export function registrarClienteSupabase(supabase) {
  cliente = supabase;
}

function payloadDoToken(token) {
  try {
    const parte = String(token || '').split('.')[1];
    if (!parte) return null;
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')));
  } catch {
    return null;
  }
}

/**
 * Chame com uma credencial que acabou de vir do servidor (login ou renovação).
 * O "iat" dela é a hora do servidor; a diferença para o relógio local é o erro do relógio.
 */
export function conferirRelogio(accessToken) {
  const iat = Number(payloadDoToken(accessToken)?.iat);
  if (!Number.isFinite(iat)) return;
  const diferenca = Math.round(Date.now() / 1000 - iat);
  diferencaRelogioS = Math.abs(diferenca) > TOLERANCIA_RELOGIO_S ? diferenca : 0;
  ouvintesRelogio.forEach((fn) => fn(diferencaRelogioS));
}

/** Diferença atual (segundos): positivo = relógio adiantado, negativo = atrasado, 0 = ok. */
export function diferencaDoRelogio() {
  return diferencaRelogioS;
}

export function ouvirRelogio(fn) {
  ouvintesRelogio.add(fn);
  return () => ouvintesRelogio.delete(fn);
}

function respostaDeTokenVencido(status, texto) {
  if (![400, 401, 403].includes(status)) return false;
  return /PGRST303|jwt expired|claim timestamp check failed|token is expired/i.test(texto);
}

function erroDeRede(error) {
  return error?.name === 'AuthRetryableFetchError' || error?.status === 0 || /fetch|network/i.test(String(error?.message || ''));
}

function sessaoExpirou() {
  try {
    sessionStorage.setItem(CHAVE_SESSAO_EXPIRADA, '1');
  } catch {
    // sessionStorage indisponível: segue sem o aviso.
  }
  cliente?.auth.signOut({ scope: 'local' }).catch(() => {});
}

/** Renova a sessão uma vez só, mesmo que várias requisições falhem juntas. */
function renovarSessao() {
  if (!renovando) {
    renovando = (async () => {
      try {
        const { data: atual } = await cliente.auth.getSession();
        if (!atual?.session) return null; // ninguém logado: não há o que renovar
        const { data, error } = await cliente.auth.refreshSession();
        if (error || !data?.session?.access_token) {
          // Sem internet: não desloga, só deixa a requisição falhar como antes.
          if (!erroDeRede(error)) sessaoExpirou();
          return null;
        }
        conferirRelogio(data.session.access_token);
        return data.session.access_token;
      } catch (err) {
        if (!erroDeRede(err)) sessaoExpirou();
        return null;
      } finally {
        setTimeout(() => { renovando = null; }, 0);
      }
    })();
  }
  return renovando;
}

/** fetch usado pelo cliente do Supabase: repete a requisição se o login tiver vencido. */
export function criarFetchSeguro(fetchBase = (...args) => fetch(...args)) {
  return async function fetchSeguro(input, init = {}) {
    const resposta = await fetchBase(input, init);
    if (!cliente || resposta.ok || ![400, 401, 403].includes(resposta.status)) return resposta;
    const url = typeof input === 'string' ? input : (input?.url || String(input));
    // As chamadas de login/renovação passam por aqui também: essas nunca são repetidas.
    if (/\/auth\/v1\//.test(url)) return resposta;

    let texto = '';
    try {
      texto = await resposta.clone().text();
    } catch {
      return resposta;
    }
    if (!respostaDeTokenVencido(resposta.status, texto)) return resposta;

    const token = await renovarSessao();
    if (!token) return resposta;
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('Authorization', `Bearer ${token}`);
    return fetchBase(input, { ...init, headers });
  };
}
