import { useEffect, useState } from 'react';
import { diferencaDoRelogio, ouvirRelogio } from '../lib/sessaoSegura';
import { Icon } from './icons';

function descreverDiferenca(segundos) {
  // Arredonda para minutos antes de separar as horas (evita "2 horas e 60 minutos").
  const totalMin = Math.max(1, Math.round(Math.abs(segundos) / 60));
  const horas = Math.floor(totalMin / 60);
  const minutos = totalMin % 60;
  const partes = [];
  if (horas) partes.push(`${horas} ${horas === 1 ? 'hora' : 'horas'}`);
  if (minutos) partes.push(`${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`);
  return partes.join(' e ');
}

/**
 * Aviso quando o relógio do computador está errado. Relógio errado faz o login
 * "vencer" o tempo todo (erro "JWT expired").
 */
export function AvisoRelogio() {
  const [diferenca, setDiferenca] = useState(diferencaDoRelogio);
  const [fechado, setFechado] = useState(false);

  useEffect(() => ouvirRelogio((valor) => {
    setDiferenca(valor);
    if (valor) setFechado(false);
  }), []);

  if (!diferenca || fechado) return null;
  const sentido = diferenca > 0 ? 'adiantado' : 'atrasado';

  return (
    <div className="aviso-relogio" role="alert">
      <span className="aviso-relogio-icone" aria-hidden="true"><Icon name="alert" size={20} /></span>
      <div className="aviso-relogio-texto">
        <strong>O relógio deste computador está {descreverDiferenca(diferenca)} {sentido}.</strong>
        <span>
          Isso faz o seu login expirar sozinho. Ajuste em Configurações do Windows → Hora e idioma → Data e hora:
          ative &quot;Definir horário automaticamente&quot; e clique em &quot;Sincronizar agora&quot;.
        </span>
      </div>
      <button type="button" className="aviso-relogio-fechar" onClick={() => setFechado(true)} aria-label="Fechar aviso">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
