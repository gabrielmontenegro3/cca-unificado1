export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR');
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatChatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function chamadoNumero(n) {
  if (n == null || n === '') return 'ID: —';
  return `ID: ${n}`;
}

export function laudoNumero(n) {
  return `Laudo #${n}`;
}

export function fileKind(mime) {
  if (!mime) return 'outro';
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('video/')) return 'video';
  if (mime.includes('pdf') || mime.includes('word') || mime.includes('text')) return 'documento';
  return 'outro';
}

export function addPeriod(date, periodicidade, customDays) {
  const base = date ? new Date(date) : new Date();
  const map = {
    diaria: 1,
    semanal: 7,
    quinzenal: 15,
    mensal: 30,
    bimestral: 60,
    trimestral: 90,
    semestral: 180,
    anual: 365,
    personalizada: Number(customDays) || 30,
  };
  base.setDate(base.getDate() + (map[periodicidade] || 30));
  return base.toISOString().slice(0, 10);
}

export function maintenanceTone(row) {
  if (!row.ativo) return 'inativa';
  if (!row.proxima_execucao) return 'em_dia';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(row.proxima_execucao);
  const diff = (next - today) / 86400000;
  if (diff < 0) return 'atrasada';
  if (diff <= 7) return 'proxima';
  return 'em_dia';
}
