
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
  },
  desconectado: {
    color: 'bg-red-500',
    text: 'Desconectado',
  },
  verificando: {
    color: 'bg-yellow-500 animate-pulse',
    text: 'Verificando...',
  },
};

export function ApiStatusIndicator({ status }: ApiStatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2">
        <div className={cn("h-3 w-3 rounded-full", config.color)} />
        <span className="text-sm text-muted-foreground hidden sm:inline">{config.text}</span>
    </div>
  );
}
