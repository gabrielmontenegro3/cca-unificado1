import { supabase } from './supabase';

export const TEMAS = [
  { id: 'claro', label: 'Claro', hint: 'Fundos claros, leitura diurna' },
  { id: 'escuro', label: 'Escuro', hint: 'Fundos escuros, menos brilho' },
];

export const FONTES = [
  { id: 'pequena', label: 'Pequena', hint: 'Bem compacta na tela' },
  { id: 'media', label: 'Média', hint: 'Tamanho padrão' },
  { id: 'grande', label: 'Grande', hint: 'Bem ampliada para leitura' },
];

export const DEFAULT_PREFS = { tema: 'claro', tamanho_fonte: 'media' };

const STORAGE_KEY = 'cca.prefs';

export function lerPrefsLocais() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.tema || !parsed?.tamanho_fonte) return null;
    return {
      tema: parsed.tema === 'escuro' ? 'escuro' : 'claro',
      tamanho_fonte: ['pequena', 'media', 'grande'].includes(parsed.tamanho_fonte)
        ? parsed.tamanho_fonte
        : 'media',
    };
  } catch {
    return null;
  }
}

export function gravarPrefsLocais(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    tema: prefs.tema,
    tamanho_fonte: prefs.tamanho_fonte,
  }));
}

export function aplicarPrefs(prefs) {
  const next = {
    tema: prefs?.tema === 'escuro' ? 'escuro' : 'claro',
    tamanho_fonte: ['pequena', 'media', 'grande'].includes(prefs?.tamanho_fonte)
      ? prefs.tamanho_fonte
      : 'media',
  };
  const root = document.documentElement;
  root.dataset.theme = next.tema;
  root.dataset.font = next.tamanho_fonte;
  return next;
}

export function prefsDoPerfil(profile) {
  if (!profile?.preferencias_ok) return null;
  if (!profile.tema || !profile.tamanho_fonte) return null;
  return {
    tema: profile.tema === 'escuro' ? 'escuro' : 'claro',
    tamanho_fonte: ['pequena', 'media', 'grande'].includes(profile.tamanho_fonte)
      ? profile.tamanho_fonte
      : 'media',
  };
}

export function precisaDefinirPreferencias(profile) {
  if (!profile) return false;
  // Sem a coluna no banco ainda: não bloqueia o acesso
  if (!Object.prototype.hasOwnProperty.call(profile, 'preferencias_ok')) return false;
  return profile.preferencias_ok !== true;
}

export async function salvarPreferencias(userId, prefs) {
  const next = aplicarPrefs(prefs);
  gravarPrefsLocais(next);
  const { data, error } = await supabase
    .from('usuarios')
    .update({
      tema: next.tema,
      tamanho_fonte: next.tamanho_fonte,
      preferencias_ok: true,
    })
    .eq('id', userId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Aplica cache local antes do React montar (evita flash). */
export function bootstrapPrefs() {
  const local = lerPrefsLocais();
  if (local) aplicarPrefs(local);
  else aplicarPrefs(DEFAULT_PREFS);
}
