
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Position = {
  pair: string;
  entryPrice: number;
  size: number; // in USDT
  stop_pct?: number;
  take_pct?: number;
}

interface OpenPositionPanelProps {
  position: Position | null;
  latestPrice: number;
}

export function OpenPositionPanel({ position, latestPrice }: OpenPositionPanelProps) {

  const unrealizedPnl = position 
    ? (latestPrice - position.entryPrice) * (position.size / position.entryPrice)
    : 0;

  const unrealizedPnlPercent = position && position.size > 0 ? (unrealizedPnl / position.size) * 100 : 0;
  
  const stopPrice = position?.entryPrice && position?.stop_pct ? position.entryPrice * (1 - position.stop_pct) : null;
  const takePrice = position?.entryPrice && position?.take_pct ? position.entryPrice * (1 + position.take_pct) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Posição Aberta</CardTitle>
        <CardDescription>Status do ativo em carteira.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 min-h-[170px]">
        {position ? (
            <div className="space-y-3">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">{position.pair}</h3>
                     <Badge variant="outline" className="bg-blue-600/20 text-blue-400 border-blue-600/30">
                        EM POSSE
                    </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                        <div className="text-muted-foreground">Valor Investido</div>
                        <div className="font-semibold">${position.size.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">PnL Não Realizado</div>
                        <div className={`font-semibold ${unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)} ({unrealizedPnlPercent.toFixed(2)}%)
                        </div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Preço de Entrada</div>
                        <div className="font-semibold">${position.entryPrice.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Preço Atual</div>
                        <div className="font-semibold">${latestPrice.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}</div>
                    </div>
                     {takePrice && (
                        <div>
                            <div className="text-muted-foreground">Take Profit (Alvo)</div>
                            <div className="font-semibold text-green-400">${takePrice.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}</div>
                        </div>
                    )}
                    {stopPrice && (
                         <div>
                            <div className="text-muted-foreground">Stop Loss</div>
                            <div className="font-semibold text-red-400">${stopPrice.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}</div>
                        </div>
                    )}
                </div>
            </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Nenhum ativo em carteira.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

    