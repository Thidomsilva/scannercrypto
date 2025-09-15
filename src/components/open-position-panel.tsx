"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Position = {
  pair: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  size: number; // in USDT
}

interface OpenPositionPanelProps {
  position: Position | null;
  latestPrice: number;
}

export function OpenPositionPanel({ position, latestPrice }: OpenPositionPanelProps) {

  const unrealizedPnl = position 
    ? position.side === 'LONG'
      ? (latestPrice - position.entryPrice) * (position.size / position.entryPrice)
      : (position.entryPrice - latestPrice) * (position.size / position.entryPrice)
    : 0;

  const unrealizedPnlPercent = position && position.size > 0 ? (unrealizedPnl / position.size) * 100 : 0;

  const getSideBadgeVariant = (side: string) => {
    return side === 'LONG' 
        ? "bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/30"
        : "bg-red-600/20 text-red-400 border-red-600/30 hover:bg-red-600/30";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Posição Aberta</CardTitle>
        <CardDescription>Status da operação atual.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 min-h-[170px]">
        {position ? (
            <div className="space-y-3">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">{position.pair}</h3>
                     <Badge variant="outline" className={getSideBadgeVariant(position.side)}>
                        {position.side}
                    </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                        <div className="text-muted-foreground">Preço de Entrada</div>
                        <div className="font-semibold">${position.entryPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Preço Atual</div>
                        <div className="font-semibold">${latestPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Tamanho (USDT)</div>
                        <div className="font-semibold">${position.size.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">PnL Não Realizado</div>
                        <div className={`font-semibold ${unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)} ({unrealizedPnlPercent.toFixed(2)}%)
                        </div>
                    </div>
                </div>
            </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Nenhuma posição aberta.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
