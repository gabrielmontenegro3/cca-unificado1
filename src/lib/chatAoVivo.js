import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

const INTERVALO_PADRAO_MS = 4000;

async function assinaturaConversa(conversaId) {
  const { data, count, error } = await supabase
    .from('mensagens')
    .select('id, excluido_em', { count: 'exact' })
    .eq('conversa_id', conversaId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return null;
  const ultima = data?.[0];
  return `${count ?? 0}|${ultima?.id || ''}|${ultima?.excluido_em || ''}`;
}

export function assinaturaMensagens(lista) {
  const rows = lista || [];
  const ultima = rows[rows.length - 1];
  return `${rows.length}|${ultima?.id || ''}|${ultima?.excluido_em || ''}`;
}

/**
 * Mantém um chat atualizado sem recarregar a página. Usa o Realtime da tabela `mensagens`
 * e, como o Realtime pode estar desligado no projeto ou filtrado por RLS, também verifica
 * periodicamente se a conversa mudou antes de chamar `onAtualizar`.
 */
export function useChatAoVivo({ conversaId, chave, onAtualizar, assinar, intervalo = INTERVALO_PADRAO_MS }) {
  const atualizarRef = useRef(onAtualizar);
  const assinarRef = useRef(assinar);

  useEffect(() => {
    atualizarRef.current = onAtualizar;
    assinarRef.current = assinar;
  });

  const alvo = chave || conversaId || null;

  useEffect(() => {
    if (!alvo || !supabase) return undefined;
    let live = true;
    let assinatura = null;
    let rodando = false;
    let pendente = false;

    async function ler() {
      try {
        if (assinarRef.current) return await assinarRef.current();
        if (conversaId) return await assinaturaConversa(conversaId);
      } catch {
        return null;
      }
      return null;
    }

    async function atualizar() {
      if (!live) return;
      if (rodando) {
        pendente = true;
        return;
      }
      rodando = true;
      try {
        await atualizarRef.current?.();
      } catch {
        /* cada tela exibe os próprios erros */
      } finally {
        const nova = await ler();
        if (live && nova != null) assinatura = nova;
        rodando = false;
        if (live && pendente) {
          pendente = false;
          atualizar();
        }
      }
    }

    async function verificar() {
      if (!live || rodando || document.visibilityState === 'hidden') return;
      const nova = await ler();
      if (!live || nova == null) return;
      if (assinatura == null) {
        assinatura = nova;
        return;
      }
      if (nova !== assinatura) {
        assinatura = nova;
        atualizar();
      }
    }

    verificar();
    const timer = window.setInterval(verificar, intervalo);
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') verificar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);

    let channel = null;
    if (conversaId) {
      channel = supabase
        .channel(`chat-ao-vivo-${conversaId}-${Math.random().toString(36).slice(2, 10)}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'mensagens', filter: `conversa_id=eq.${conversaId}` },
          () => atualizar(),
        )
        .subscribe();
    }

    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      if (channel) supabase.removeChannel(channel);
    };
  }, [alvo, conversaId, intervalo]);
}
