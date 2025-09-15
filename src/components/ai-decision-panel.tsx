"use client";

import { useState, useTransition } from "react";
import { getAIDecisionAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { GetLLMTradingDecisionOutput } from "@/ai/flows/llm-powered-trading-decisions";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

interface AIDecisionPanelProps {
  onNewDecision: (decision: GetLLMTradingDecisionOutput) => void;
  disabled: boolean;
}

export function AIDecisionPanel({ onNewDecision, disabled }: AIDecisionPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [decision, setDecision] = useState<GetLLMTradingDecisionOutput | null>(null);
  const { toast } = useToast();

  const handleGetDecision = () => {
    startTransition(async () => {
      const { data, error } = await getAIDecisionAction();
      if (error) {
        toast({
          variant: "destructive",
          title: "AI Error",
          description: error,
        });
        setDecision(null);
      } else if (data) {
        setDecision(data);
        onNewDecision(data);
      }
    });
  };

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
    <Card>
      <CardHeader>
        <CardTitle>AI Trading Decision</CardTitle>
        <CardDescription>Get a real-time trading recommendation from the AI.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled && (
          <Alert variant="destructive">
            <Zap className="h-4 w-4" />
            <AlertTitle>Kill-Switch Active</AlertTitle>
            <AlertDescription>
              Trading is disabled due to reaching the daily loss limit.
            </AlertDescription>
          </Alert>
        )}
        {decision && (
          <div className="p-4 rounded-lg border bg-secondary/50 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-lg">{decision.pair}</h3>
              <Badge variant="outline" className={getActionBadgeVariant(decision.action)}>
                {decision.action}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground italic">"{decision.rationale}"</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="font-medium text-muted-foreground">Confidence: </span> {(decision.confidence * 100).toFixed(1)}%</div>
                <div><span className="font-medium text-muted-foreground">Order Type: </span> {decision.order_type}</div>
                <div><span className="font-medium text-muted-foreground">Notional: </span> ${decision.notional_usdt}</div>
                {decision.stop_price && <div><span className="font-medium text-muted-foreground">Stop Loss: </span> ${decision.stop_price}</div>}
                {decision.take_price && <div><span className="font-medium text-muted-foreground">Take Profit: </span> ${decision.take_price}</div>}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={handleGetDecision} disabled={isPending || disabled} className="w-full bg-primary hover:bg-primary/90">
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Zap className="mr-2 h-4 w-4" />
          )}
          {isPending ? "Analyzing..." : "Get AI Decision"}
        </Button>
      </CardFooter>
    </Card>
  );
}
