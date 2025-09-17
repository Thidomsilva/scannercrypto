
"use client";

import { cn } from "@/lib/utils";

export type ApiStatus = 'conectado' | 'desconectado' | 'verificando';

interface ApiStatusIndicatorProps {
  status: ApiStatus;
}

const statusConfig = {
  conectado: {
    color: 'bg-green-500',
    text: 'Conectado',
    tooltip: 'A conexão com a API da corretora está ativa.',
  },
  desconectado: {
    color: 'bg-red-500',
    text: 'Desconectado',
    tooltip: 'Não foi possível conectar à API da corretora. Verifique suas chaves de API e a conectividade.',
  },
  verificando: {
    color: 'bg-yellow-500 animate-pulse',
    text: 'Verificando...',
    tooltip: 'Verificando a conexão com a API da corretora...',
  },
};

export function ApiStatusIndicator({ status }: ApiStatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2" title={config.tooltip}>
        <div className={cn("h-3 w-3 rounded-full", config.color)} />
        <span className="text-sm text-muted-foreground hidden sm:inline">{config.text}</span>
    </div>
  );
}
