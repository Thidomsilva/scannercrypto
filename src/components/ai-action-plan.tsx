
"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lightbulb, ShieldCheck, TrendingDown, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GetLLMTradingDecisionOutput } from "@/ai/schemas";
import { Button } from "./ui/button";

interface AIActionPlanProps {
    analysis: GetLLMTradingDecisionOutput['positionAnalysis'] | undefined;
    isAnalyzing: boolean;
    onForceAnalysis: () => void;
}


function Condition({ title, description, isOk, isAnalyzing }: { title: string; description: string; isOk?: boolean; isAnalyzing: boolean; }) {
    const getStatus = () => {
        if (isAnalyzing) return { text: "Analisando...", color: "text-muted-foreground", iconColor: "text-muted-foreground" };
        if (isOk === undefined) return { text: "Aguardando...", color: "text-muted-foreground", iconColor: "text-muted-foreground" };
        if (isOk) return { text: "OK", color: "text-green-400", iconColor: "text-green-500" };
        return { text: "Inválido", color: "text-red-400", iconColor: "text-red-500" };
    };

    const { text, color, iconColor } = getStatus();

    return (
        <div className="flex items-start gap-3 p-2 rounded-md bg-secondary/50">
            {title.includes("Estrutura") 
              ? <TrendingDown className={cn("h-5 w-5 mt-1 flex-shrink-0", isAnalyzing ? "text-muted-foreground" : iconColor)} />
              : <ShieldCheck className={cn("h-5 w-5 mt-1 flex-shrink-0", isAnalyzing ? "text-muted-foreground" : iconColor)} />
            }
            <div className="flex-1">
                <div className="flex justify-between items-center">
                    <h4 className="font-medium">{title}</h4>
                     {isAnalyzing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                     {!isAnalyzing && <span className={cn("text-xs font-bold", color)}>{text}</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                    {description}
                </p>
            </div>
        </div>
    );
}

export function AIActionPlan({ analysis, isAnalyzing, onForceAnalysis }: AIActionPlanProps) {
  return (
    <Alert variant="default" className="bg-background border-primary/20 text-foreground">
        <div className="flex justify-between items-start">
             <div className="flex-grow">
                 <div className="flex items-center mb-1">
                     <Lightbulb className="h-4 w-4 mr-2" />
                    <AlertTitle className="font-semibold">
                        Plano de Ação da IA (Posição Aberta)
                    </AlertTitle>
                 </div>
                 <AlertDescription asChild>
                    <div className="space-y-2 mt-2">
                        <p className="text-sm">
                            A IA está a gerir ativamente a posição. A venda será acionada se uma das condições abaixo for invalidada.
                        </p>
                        <Condition 
                            title="Estrutura Técnica"
                            description="O preço deve manter-se acima dos níveis técnicos chave (ex: EMA50 1m) que suportaram a decisão de compra."
                            isOk={analysis?.technicalStructureOK}
                            isAnalyzing={isAnalyzing}
                        />
                        <Condition 
                            title="Valor Esperado (EV)"
                            description="A relação risco/retorno da operação deve permanecer favorável. EV negativo invalida a premissa."
                            isOk={analysis?.evOK}
                            isAnalyzing={isAnalyzing}
                        />
                    </div>
                </AlertDescription>
             </div>
             <Button 
                variant="outline" 
                size="sm" 
                onClick={onForceAnalysis}
                disabled={isAnalyzing}
                className="ml-4 flex-shrink-0"
            >
                {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Forçar Análise
             </Button>
        </div>
    </Alert>
  );
}
