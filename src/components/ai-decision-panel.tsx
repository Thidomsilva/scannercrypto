"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Bot, CircleUserRound, AlertTriangle } from "lucide-react";
import type { GetLLMTradingDecisionOutput } from "@/ai/flows/llm-powered-trading-decisions";
import type { ReactNode } from "react";

interface AIDecisionPanelProps {
  children: ReactNode;
  onGetDecision: () => void;
  isPending: boolean;
  disabled: boolean;
  isAutomated: boolean;
}

export function AIStatus({ status, isError }: { status: string, isError?: boolean }) {
  return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 rounded-lg border bg-secondary/50">
        {isError ? (
            <AlertTriangle className="mr-2 h-4 w-4 text-destructive" />
        ) : (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        )}
      <span>{status}</span>
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

  return (
    <div className="p-4 rounded-lg border bg-secondary/50 space-y-3 animate-in fade-in-50">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-lg">{decision.pair}</h3>
        <Badge variant="outline" className={getActionBadgeVariant(decision.action)}>
          {decision.action}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground italic">"{decision.rationale}"</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <div><span className="font-medium text-muted-foreground">Confiança: </span> {(decision.confidence * 100).toFixed(1)}%</div>
          <div><span className="font-medium text-muted-foreground">Tipo: </span> {decision.order_type}</div>
          <div><span className="font-medium text-muted-foreground">Notional: </span> ${decision.notional_usdt.toFixed(2)}</div>
          {decision.stop_price && <div><span className="font-medium text-muted-foreground">Stop: </span> ${decision.stop_price}</div>}
          {decision.take_price && <div><span className="font-medium text-muted-foreground">Take: </span> ${decision.take_price}</div>}
      </div>
    </div>
  );
}


export function AIDecisionPanel({ children, onGetDecision, isPending, disabled, isAutomated }: AIDecisionPanelProps) {
  
  const buttonText = isAutomated 
    ? (isPending ? "Analisando..." : "Aguardando...")
    : (isPending ? "Analisando..." : "Obter Decisão Manual");

  const ButtonIcon = isAutomated ? Bot : CircleUserRound;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisão da IA</CardTitle>
        <CardDescription>Recomendação de trading gerada pela IA.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 min-h-[210px] sm:min-h-[170px]">
        {children}
      </CardContent>
      <CardFooter>
        <Button onClick={onGetDecision} disabled={disabled} className="w-full">
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ButtonIcon className="mr-2 h-4 w-4" />
          )}
          {buttonText}
        </Button>
      </CardFooter>
    </Card>
  );
}


export function AIResponse({ result }: { result: any }) {
    if (result.error) {
        return <AIStatus status={`Erro: ${result.error}`} isError />;
    }
    return <AIDecisionPanelContent decision={result.data} />;
}
