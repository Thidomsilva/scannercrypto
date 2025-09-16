
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Bot, CircleUserRound, AlertTriangle, Play } from "lucide-react";
import type { GetLLMTradingDecisionOutput } from "@/ai/schemas";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";


interface AIDecisionPanelProps {
  children: ReactNode;
  onGetDecision: () => void;
  onExecuteDecision: () => void;
  isPending: boolean;
  disabled: boolean;
  isAutomated: boolean;
  showExecuteButton?: boolean;
}

export function AIStatus({ status, isError }: { status: string, isError?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-sm text-muted-foreground p-4 rounded-lg border bg-secondary/50 min-h-[170px]">
        <div className="flex items-center text-center">
            {isError ? (
                <AlertTriangle className="mr-2 h-4 w-4 text-destructive" />
            ) : (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
          <span>{status}</span>
        </div>
    </div>
  );
}

export function AIDecisionPanelContent({ decision }: { decision: GetLLMTradingDecisionOutput | null }) {
  if (!decision) {
    return <AIStatus status="Falha ao obter decisão da IA." isError />;
  }

  const getActionBadgeVariant = (action: string) => {
    switch (action) {
      case "BUY":
        return "bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/30";
      case "SELL":
        return "bg-red-600/20 text-red-400 border-red-600/30 hover:bg-red-600/30";
      default:
        return "secondary";
    }
  };
  
  const pUpPercent = (decision.p_up * 100).toFixed(1);
  const stopPercent = decision.stop_pct ? (decision.stop_pct * 100).toFixed(2) : null;
  const takePercent = decision.take_pct ? (decision.take_pct * 100).toFixed(2) : null;
  const evPercent = decision.EV ? (decision.EV * 100).toFixed(3) : null;


  return (
    <div className="p-4 rounded-lg border bg-secondary/50 space-y-3 animate-in fade-in-50">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-lg">{decision.pair}</h3>
        <Badge variant="outline" className={getActionBadgeVariant(decision.action)}>
          {decision.action}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground italic">"{decision.rationale}"</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          <div><span className="font-medium text-muted-foreground">Confiança: </span> {(decision.confidence * 100).toFixed(1)}%</div>
          <div><span className="font-medium text-muted-foreground">P(Up): </span> {pUpPercent}%</div>
          {evPercent && <div><span className="font-medium text-muted-foreground">EV: </span> {evPercent}%</div>}
          <div><span className="font-medium text-muted-foreground">Notional: </span> ${decision.notional_usdt.toFixed(2)}</div>
          {stopPercent && <div><span className="font-medium text-muted-foreground">Stop: </span> {stopPercent}%</div>}
          {takePercent && <div><span className="font-medium text-muted-foreground">Take: </span> {takePercent}%</div>}
          {decision.limit_price && <div><span className="font-medium text-muted-foreground">Limit: </span> ${decision.limit_price.toFixed(4)}</div>}
      </div>
    </div>
  );
}


export function AIDecisionPanel({ children, onGetDecision, onExecuteDecision, isPending, disabled, isAutomated, showExecuteButton }: AIDecisionPanelProps) {
  
  const getDecisionButtonText = isAutomated 
    ? (isPending ? "Analisando..." : "Monitorando...")
    : (isPending ? "Analisando..." : "Obter Decisão Manual");

  const GetDecisionButtonIcon = isAutomated ? Bot : CircleUserRound;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisão da IA</CardTitle>
        <CardDescription>Recomendação de trading baseada em Valor Esperado (EV).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 min-h-[210px] sm:min-h-[170px]">
        {children}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button onClick={onGetDecision} disabled={disabled} className={cn("w-full", { "hidden": showExecuteButton })}>
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <GetDecisionButtonIcon className="mr-2 h-4 w-4" />
          )}
          {getDecisionButtonText}
        </Button>
        {showExecuteButton && (
           <Button onClick={onGetDecision} disabled={disabled} variant="secondary" className="w-1/3">
             <CircleUserRound className="mr-2 h-4 w-4" />
             Analisar
           </Button>
        )}
        {showExecuteButton && (
          <Button onClick={onExecuteDecision} disabled={disabled} className="w-2/3">
            {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
                <Play className="mr-2 h-4 w-4" />
            )}
            Executar Ordem
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

    