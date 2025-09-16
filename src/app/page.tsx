
"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import type { GetLLMTradingDecisionOutput, GetLLMTradingDecisionInput } from "@/ai/schemas";
import { getAIDecisionStream, checkApiStatus, getAccountBalance, executeTradeAction } from "@/app/actions";
import { AIDecisionPanelContent, AIStatus } from "@/components/ai-decision-panel";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OrderLog, type Trade } from "@/components/order-log";
import { PNLSummary } from "@/components/pnl-summary";
import { OpenPositionPanel } from "@/components/open-position-panel";
import { Button } from "@/components/ui/button";
import { RefreshCw, Bot, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiStatusIndicator, type ApiStatus } from "@/components/api-status-indicator";
import { AnalysisGrid } from "@/components/analysis-grid";
import { useStreamableValue } from 'ai/rsc';
import type { StreamableValue } from 'ai/rsc';
import { AIDecisionPanel } from "@/components/ai-decision-panel";
import { DailyPnlCalendar } from "@/components/daily-pnl-calendar";
import { db } from "@/lib/firebase";
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, Timestamp } from "firebase/firestore";


type Position = {
  pair: string;
  entryPrice: number;
  size: number; // in USDT
}

type FirestoreTrade = Omit<Trade, 'timestamp'> & {
    timestamp: Timestamp | null;
};

type StreamPayload = {
    data: GetLLMTradingDecisionOutput;
    error: string | null;
    executionResult: any;
    latestPrice: number;
    pair: string;
    metadata: any;
} | null;


// --- Constants & Configuration ---
const RISK_PER_TRADE = 0.3; // This is now controlled by Kelly Criterion, but can be a fallback.
const DAILY_LOSS_LIMIT = -0.02; // -2% daily loss limit
const AUTOMATION_INTERVAL = 30000; // 30 seconds
const API_STATUS_CHECK_INTERVAL = 30000; // 30 seconds
const TRADABLE_PAIRS = ['XRP/USDT', 'DOGE/USDT', 'SHIB/USDT', 'PEPE/USDT'];
const COOLDOWN_PERIOD = 75000; // 75 seconds cool-down per pair

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [initialCapital, setInitialCapital] = useState<number | null>(null);
  const [capital, setCapital] = useState<number | null>(null);
  const [dailyPnl, setDailyPnl] = useState(0);
  const [isAutomationEnabled, setIsAutomationEnabled] = useState(false);
  const [openPosition, setOpenPosition] = useState<Position | null>(null);
  const [lastAnalysisTimestamp, setLastAnalysisTimestamp] = useState<Record<string, number>>({});
  const [latestPriceMap, setLatestPriceMap] = useState<Record<string, number>>({
    'BTC/USDT': 65000,
    'ETH/USDT': 3500,
    'SOL/USDT': 150,
    'XRP/USDT': 0.47,
    'DOGE/USDT': 0.12,
    'SHIB/USDT': 0.00002,
    'PEPE/USDT': 0.00001,
  });
  const [isPending, startTransition] = useTransition();
  const [isExecuting, startExecutingTransition] = useTransition();
  const [apiStatus, setApiStatus] = useState<ApiStatus>('verificando');
  const [streamValue, setStreamValue] = useState<StreamableValue<any>>();
  const [streamedData] = useStreamableValue(streamValue);
  const [lastDecision, setLastDecision] = useState<StreamPayload>(null);

  const { toast } = useToast();

  const dailyLossPercent = capital && initialCapital ? dailyPnl / initialCapital : 0;
  const isKillSwitchActive = dailyLossPercent <= DAILY_LOSS_LIMIT;
  
  const latestPrice = openPosition ? latestPriceMap[openPosition.pair] : (latestPriceMap['BTC/USDT']);
  
  // Listen for trades from Firestore
  useEffect(() => {
    const q = query(collection(db, "trades"), orderBy("timestamp", "desc"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const tradesData: Trade[] = [];
      querySnapshot.forEach((doc) => {
          const data = doc.data() as FirestoreTrade;
           tradesData.push({
              ...data,
              id: doc.id,
              timestamp: data.timestamp ? data.timestamp.toDate() : new Date(), // Convert Firestore Timestamp to JS Date
          });
      });
      setTrades(tradesData);
    }, (error) => {
        console.error("Firestore snapshot error:", error);
        toast({
          variant: "destructive",
          title: "Erro de Conexão com DB",
          description: "Não foi possível carregar o histórico de trades.",
        });
    });

    return () => unsubscribe();
  }, [toast]);
  
  // Recalculate capital, PNL, and open position when trades change
  useEffect(() => {
      if (trades.length > 0 && initialCapital !== null) {
          let currentCapital = initialCapital;
          let pnlToday = 0;
          let lastOpenTrade: Trade | null = null;

          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const chronologicalTrades = [...trades].reverse();

          for (const trade of chronologicalTrades) {
              if (trade.timestamp >= today) {
                 if (trade.status === 'Fechada') {
                    pnlToday += trade.pnl;
                 }
              }
              if (trade.status === 'Fechada') {
                  currentCapital += trade.pnl;
              }
          }
          
          lastOpenTrade = chronologicalTrades.find(t => t.status === 'Aberta') || null;

          setCapital(currentCapital);
          setDailyPnl(pnlToday);

          if (lastOpenTrade) {
              setOpenPosition({
                  pair: lastOpenTrade.pair,
                  entryPrice: lastOpenTrade.price,
                  size: lastOpenTrade.notional,
              });
          } else {
              setOpenPosition(null);
          }
      } else if (initialCapital !== null) {
          setCapital(initialCapital);
          setDailyPnl(0);
          setOpenPosition(null);
      }

  }, [trades, initialCapital]);

  const handleApiStatusCheck = useCallback(async () => {
    const status = await checkApiStatus();
    setApiStatus(status);
    if (status === 'conectado') {
        if (capital === null) { // Fetch balance only if it's not set
            fetchBalance();
        }
    } else {
        if (initialCapital === null) {
            setCapital(18); 
            setInitialCapital(18);
        }
    }
  }, [capital, initialCapital]);
  
  const fetchBalance = useCallback(async () => {
      try {
          const balance = await getAccountBalance();
          if (initialCapital === null) { 
              setInitialCapital(balance);
          }
           setCapital(balance);
      } catch (e) {
          console.error("Falha ao buscar saldo:", e);
          toast({
              variant: "destructive",
              title: "Erro ao buscar saldo",
              description: "Não foi possível obter o saldo da conta. Usando valor simulado.",
          });
          if (initialCapital === null) {
             setInitialCapital(18);
          }
          setCapital(18);
      }
  }, [toast, initialCapital]);

  useEffect(() => {
    handleApiStatusCheck(); 
    const intervalId = setInterval(handleApiStatusCheck, API_STATUS_CHECK_INTERVAL);
    return () => clearInterval(intervalId);
  }, [handleApiStatusCheck]);

  const handleNewDecision = useCallback(async (decision: GetLLMTradingDecisionOutput, executionResult: any, newLatestPrice: number, metadata: any) => {
    
     console.log('--- DECISION VALIDATION METRICS ---', {
        pair: decision.pair,
        p_up: decision.p_up,
        EV: metadata.expectedValue,
        stop_pct: decision.stop_pct,
        take_pct: decision.take_pct,
        spread: metadata.spread,
        action: decision.action,
        notional: decision.notional_usdt,
        reason_if_skip: decision.action === 'HOLD' ? decision.rationale : 'N/A',
        order_type_proposed: decision.order_type,
        fee_est: metadata.estimatedFees,
        slip_est: metadata.estimatedSlippage,
    });
      
    if (decision.pair !== 'NONE') {
        setLatestPriceMap(prev => ({...prev, [decision.pair]: newLatestPrice}));
        setLastAnalysisTimestamp(prev => ({...prev, [decision.pair]: Date.now() }));
    }
    
    const saveTrade = async (tradeData: Omit<Trade, 'id' | 'timestamp'>) => {
        try {
            await addDoc(collection(db, "trades"), {
                ...tradeData,
                timestamp: serverTimestamp() 
            });
        } catch (error) {
            console.error("Erro ao salvar trade no Firestore: ", error);
            toast({
              variant: "destructive",
              title: "Erro de Banco de Dados",
              description: "Não foi possível salvar a operação no histórico.",
            });
        }
    };

    if (decision.action === "HOLD" || executionResult?.success === false) {
      const newTrade: Omit<Trade, 'id' | 'timestamp'> = {
        pair: decision.pair,
        action: decision.action,
        price: newLatestPrice,
        notional: 0,
        pnl: 0,
        rationale: executionResult?.success === false ? `Falha na Execução: ${executionResult.message}` : decision.rationale,
        status: executionResult?.success === false ? "Falhou" : "Registrada",
      };
      await saveTrade(newTrade);

       if (executionResult?.success === false) {
        toast({
          variant: "destructive",
          title: "Falha na Execução",
          description: executionResult.message,
          action: <XCircle className="text-destructive-foreground" />,
        });
      }
      return;
    }
    
    if (!executionResult?.orderId && decision.action !== 'HOLD') {
        const logMessage: Omit<Trade, 'id' | 'timestamp'> = {
            pair: decision.pair,
            action: decision.action,
            price: newLatestPrice,
            notional: 0, 
            pnl: 0,
            rationale: executionResult?.message || `Execução ignorada no modo simulação.`,
            status: "Registrada",
        };
        await saveTrade(logMessage);
        return;
    }
    
    toast({
        title: `Ordem Executada: ${decision.action} ${decision.pair}`,
        description: `Notional: $${decision.notional_usdt.toFixed(2)} @ $${newLatestPrice.toFixed(2)}`,
        action: <CheckCircle className="text-green-500" />,
    });


    if (openPosition && openPosition.pair === decision.pair && decision.action === 'SELL') {
        const pnl = (newLatestPrice - openPosition.entryPrice) * (openPosition.size / openPosition.entryPrice);
        
        const newTrade: Omit<Trade, 'id' | 'timestamp'> = {
            pair: decision.pair,
            action: decision.action,
            price: newLatestPrice,
            notional: openPosition.size,
            pnl: parseFloat(pnl.toFixed(2)),
            rationale: `FECHAMENTO: ${decision.rationale}`,
            status: "Fechada",
        };
        await saveTrade(newTrade);
        return;
    }

    if (!openPosition && decision.action === 'BUY') {
        const newTrade: Omit<Trade, 'id' | 'timestamp'> = {
            pair: decision.pair,
            action: decision.action,
            price: newLatestPrice,
            notional: decision.notional_usdt,
            pnl: 0,
            rationale: `ABERTURA: ${decision.rationale}`,
            status: "Aberta",
        };
        await saveTrade(newTrade);
    }
  }, [openPosition, toast]);
  
   useEffect(() => {
    if (!streamedData) return;

    if (streamedData.status === 'done') {
      const payload: StreamPayload = streamedData.payload;
      if (payload?.error) {
        toast({
          variant: 'destructive',
          title: 'Erro da IA',
          description: payload.error,
        });
         setLastDecision(null);
      } else if (payload?.data && payload.latestPrice !== null && payload.pair) {
        if (!isAutomationEnabled) { // Only store last decision if in manual mode
          setLastDecision(payload);
        } else {
          handleNewDecision(payload.data, payload.executionResult, payload.latestPrice, payload.metadata || {});
          setLastDecision(null);
        }
      }
    } else if (streamedData.status === 'analyzing') {
       setLastDecision(null);
    }
  }, [streamedData, handleNewDecision, toast, isAutomationEnabled]);

  const getAIDecision = useCallback((execute: boolean = false) => {
    if(isPending || isKillSwitchActive || capital === null) return;
    
    startTransition(async () => {
      const aiInputBase: Pick<GetLLMTradingDecisionInput, 'availableCapital' | 'currentPosition'> = {
        availableCapital: capital,
        currentPosition: {
          status: openPosition ? 'IN_POSITION' : 'NONE',
          entryPrice: openPosition?.entryPrice,
          size: openPosition?.size,
          pair: openPosition?.pair,
        },
      };

      const now = Date.now();
      const pairsToAnalyze = TRADABLE_PAIRS.filter(pair => {
          if (openPosition && openPosition.pair !== pair) return false; // If in position, only analyze that pair
          const lastAnalyzed = lastAnalysisTimestamp[pair] || 0;
          return now - lastAnalyzed > COOLDOWN_PERIOD;
      });

      if (pairsToAnalyze.length === 0 && !openPosition) {
          console.log("Todos os pares em cool-down ou posição aberta em outro par. Pulando ciclo de análise.");
          setStreamValue(undefined); // Clear any previous analysis grid
          setLastDecision(null);
          return;
      }
      
      const result = await getAIDecisionStream(aiInputBase, pairsToAnalyze, execute);
      setStreamValue(result);
    });
  }, [isPending, capital, isKillSwitchActive, openPosition, lastAnalysisTimestamp]);
  
  
  const handleExecuteManual = useCallback(async () => {
    if (!lastDecision || !lastDecision.data || isExecuting) return;

    startExecutingTransition(async () => {
      try {
        const executionResult = await executeTradeAction(lastDecision.data);
        handleNewDecision(lastDecision.data, executionResult, lastDecision.latestPrice, lastDecision.metadata);
        setLastDecision(null); // Clear decision after execution
      } catch (error) {
         console.error("Erro na execução manual:", error);
         toast({
          variant: "destructive",
          title: "Erro de Execução",
          description: error instanceof Error ? error.message : "Ocorreu um erro desconhecido.",
        });
      }
    });

  }, [lastDecision, isExecuting, handleNewDecision, toast]);


  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (isAutomationEnabled && !isKillSwitchActive && apiStatus === 'conectado') {
      getAIDecision(true); 
      intervalId = setInterval(() => getAIDecision(true), AUTOMATION_INTERVAL);
    }
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isAutomationEnabled, isKillSwitchActive, getAIDecision, apiStatus]);

  const resetSimulation = () => {
    setTrades([]);
    setCapital(initialCapital);
    setDailyPnl(0);
    setOpenPosition(null);
    setIsAutomationEnabled(false);
    setStreamValue(undefined);
    setLastAnalysisTimestamp({});
    setLastDecision(null);
    setLatestPriceMap({
      'BTC/USDT': 65000, 'ETH/USDT': 3500, 'SOL/USDT': 150,
      'XRP/USDT': 0.47, 'DOGE/USDT': 0.12,
    });
    handleApiStatusCheck();
    toast({ title: "Simulação Resetada", description: "O histórico local foi limpo. Para limpar o DB, seria necessária uma ação de servidor." });

  };
  
  const manualDecisionDisabled = isPending || isKillSwitchActive || isAutomationEnabled || apiStatus !== 'conectado' || isExecuting;
  const isAutomated = isAutomationEnabled && !isKillSwitchActive && apiStatus === 'conectado';
  const showExecuteButton = !isAutomationEnabled && lastDecision && lastDecision.data && (lastDecision.data.action === 'BUY' || lastDecision.data.action === 'SELL');


  const renderAIDecision = () => {
    if (streamedData?.status === 'analyzing') {
      return (
        <AnalysisGrid
          pairs={TRADABLE_PAIRS}
          currentlyAnalyzing={streamedData.payload.pair}
          statusText={streamedData.payload.text}
        />
      );
    }
    
    const decisionToRender = lastDecision?.data;

    if (decisionToRender) {
      return <AIDecisionPanelContent decision={decisionToRender} />;
    }

    if (streamedData?.status === 'done' && streamedData.payload.error) {
        return <AIStatus status={`Erro: ${streamedData.payload.error}`} isError />;
    }
    
    return <AIStatus status="Aguardando decisão da IA..." />;
  };

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-6 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Dashboard CryptoSage
          </h1>
          <div className="flex w-full md:w-auto items-center justify-between md:justify-end gap-4">
            <ApiStatusIndicator status={apiStatus} />
             <div className="flex items-center space-x-2">
              <Switch 
                id="automation-mode" 
                checked={isAutomationEnabled} 
                onCheckedChange={(checked) => {
                  setIsAutomationEnabled(checked);
                  setLastDecision(null); // Clear last decision when toggling mode
                  if (!checked) {
                    setStreamValue(undefined);
                  }
                }}
                disabled={isKillSwitchActive || apiStatus !== 'conectado'}
              />
              <Label htmlFor="automation-mode" className="flex items-center gap-2 text-sm md:text-base">
                <Bot className="h-5 w-5" />
                <span className="hidden sm:inline">Modo Autônomo</span>
                 <span className="sm:hidden">Auto</span>
              </Label>
            </div>
            <Button onClick={resetSimulation} variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Resetar
            </Button>
          </div>
        </div>
         {isKillSwitchActive && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Kill-Switch Ativo</AlertTitle>
            <AlertDescription>
              As operações foram desativadas por atingir o limite de perda diária. Resete a simulação para continuar.
            </AlertDescription>
          </Alert>
        )}
        {apiStatus === 'desconectado' && !isKillSwitchActive && (
           <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>API Desconectada</AlertTitle>
            <AlertDescription>
               O robô não pode operar. Verifique se as chaves de API estão configuradas corretamente no ambiente.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 flex flex-col gap-6">
            <AIDecisionPanel 
              onGetDecision={() => getAIDecision(false)}
              onExecuteDecision={handleExecuteManual}
              isPending={isPending || isExecuting}
              disabled={manualDecisionDisabled}
              isAutomated={isAutomated}
              showExecuteButton={showExecuteButton}
            >
              {renderAIDecision()}
            </AIDecisionPanel>
          </div>
          <div className="lg:col-span-3 flex flex-col gap-6">
             <div className="grid md:grid-cols-2 gap-6">
                <PNLSummary 
                capital={capital}
                initialCapital={initialCapital}
                dailyPnl={dailyPnl}
                dailyLossLimit={DAILY_LOSS_LIMIT}
                />
                <OpenPositionPanel 
                position={openPosition}
                latestPrice={latestPrice}
                />
            </div>
             <DailyPnlCalendar trades={trades} initialCapital={initialCapital} />
          </div>
          <div className="lg:col-span-5">
            <OrderLog trades={trades} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
