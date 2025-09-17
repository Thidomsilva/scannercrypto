
"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lightbulb, ShieldCheck, TrendingDown } from "lucide-react";

export function AIActionPlan() {
  return (
    <Alert variant="default" className="bg-background border-primary/20 text-foreground">
      <Lightbulb className="h-4 w-4" />
      <AlertTitle className="font-semibold">
        Plano de Ação da IA (Posição Aberta)
      </AlertTitle>
      <AlertDescription>
        <div className="space-y-2 mt-2">
            <p>
                A IA está a gerir ativamente a posição aberta. A decisão de vender será acionada por uma das seguintes condições, o que ocorrer primeiro:
            </p>
            <div className="flex items-start gap-3 p-2 rounded-md bg-secondary/50">
                <TrendingDown className="h-5 w-5 text-destructive mt-1 flex-shrink-0" />
                <div>
                    <h4 className="font-medium">Quebra de Estrutura Técnica</h4>
                    <p className="text-xs text-muted-foreground">
                        Se o preço fechar abaixo de um nível técnico chave (ex: EMA50 no gráfico de 1 minuto), indicando que a tendência de alta perdeu força.
                    </p>
                </div>
            </div>
             <div className="flex items-start gap-3 p-2 rounded-md bg-secondary/50">
                <ShieldCheck className="h-5 w-5 text-destructive mt-1 flex-shrink-0" />
                <div>
                    <h4 className="font-medium">Invalidação do Valor Esperado (EV)</h4>
                    <p className="text-xs text-muted-foreground">
                        Se o Valor Esperado (EV) da operação se tornar consistentemente negativo, indicando que a relação risco/retorno já não é favorável.
                    </p>
                </div>
            </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
