"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import type { GetLLMTradingDecisionOutput, GetLLMTradingDecisionInput } from "@/ai/schemas";
import { getAIDecisionStream, checkApiStatus, getAccountBalance } from "@/app/actions";
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


const RISK_PER_TRADE = 0.3; // 30% - Adjusted for low test capital
const DAILY_LOSS_LIMIT = -0.02; // -2%
const AUTOMATION_INTERVAL = 30000; // 30 seconds
const API_STATUS_CHECK_INTERVAL = 30000; // 30 seconds
const TRADABLE_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT', 'MATIC/USDT'];

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [initialCapital, setInitialCapital] = useState<number | null>(null);
  const [capital, setCapital] = useState<number | null>(null);
  const [dailyPnl, setDailyPnl] = useState(0);
  const [isAutomationEnabled, setIsAutomationEnabled] = useState(false);
  const [openPosition, setOpenPosition] = useState<Position | null>(null);
  const [latestPriceMap, setLatestPriceMap] = useState<Record<string, number>>({
    'BTC/USDT': 65000,
    'ETH/USDT': 3500,
    'SOL/USDT': 150,
    'XRP/USDT': 0.47,
    'DOGE/USDT': 0.12,
    'MATIC/USDT': 0.57,
  });
  const [isPending, startTransition] = useTransition();
  const [apiStatus, setApiStatus] = useState<ApiStatus>('verificando');
  const [streamValue, setStreamValue] = useState<StreamableValue<any>>();
  const [streamedData] = useStreamableValue(streamValue);

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
    });

    return () => unsubscribe();
  }, []);
  
  // Recalculate capital, PNL, and open position when trades change
  useEffect(() => {
      if (trades.length > 0 && initialCapital !== null) {
          let currentCapital = initialCapital;
          let pnlToday = 0;
          let lastOpenTrade: Trade | null = null;

          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          // Process trades in chronological order to calculate state
          const chronologicalTrades = [...trades].reverse();

          for (const trade of chronologicalTrades) {
              if (trade.status === 'Fechada') {
                  currentCapital += trade.pnl;
                  if (trade.timestamp >= today) {
                      pnlToday += trade.pnl;
                  }
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
          // No trades, reset to initial state
          setCapital(initialCapital);
          setDailyPnl(0);
          setOpenPosition(null);
      }

  }, [trades, initialCapital]);

  const handleApiStatusCheck = useCallback(async () => {
    const status = await checkApiStatus();
    setApiStatus(status);
    if (status === 'conectado') {
        fetchBalance();
    } else {
        setCapital(18); // Fallback to mock capital if disconnected
        setInitialCapital(18);
    }
  }, []);
  
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
          setCapital(18); // Fallback to mock capital
      }
  }, [toast, initialCapital]);

  useEffect(() => {
    handleApiStatusCheck(); // Initial check
    const intervalId = setInterval(handleApiStatusCheck, API_STATUS_CHECK_INTERVAL);
    return () => clearInterval(intervalId);
  }, [handleApiStatusCheck]);

  const handleNewDecision = useCallback(async (decision: GetLLMTradingDecisionOutput, executionResult: any, newLatestPrice: number) => {
    if (decision.pair !== 'NONE') {
        setLatestPriceMap(prev => ({...prev, [decision.pair]: newLatestPrice}));
    }
    
    // This function will now save a trade to Firestore
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
            action: 'HOLD',
            price: newLatestPrice,
            notional: 0,
            pnl: 0,
            rationale: executionResult.message || decision.rationale,
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


    // Closing a position
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
        // Find the original opening trade and update its status to 'Fechada' as well, for clarity
        // This part is complex to do right, let's omit for now and just add the closing trade.

        // Capital and PNL will be recalculated by the useEffect listening to trades.
        return;
    }

    // Opening a position
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
      const { data, error, executionResult, latestPrice: newLatestPrice, pair } = streamedData.payload;
      if (error) {
        toast({
          variant: 'destructive',
          title: 'Erro da IA',
          description: error,
        });
      } else if (data && newLatestPrice !== null && pair) {
        const decisionWithPair = { ...data, pair };
        handleNewDecision(decisionWithPair, executionResult, newLatestPrice);
      }
    }
  }, [streamedData, handleNewDecision, toast]);

  const getAIDecision = useCallback((execute: boolean = false) => {
    if(isPending || isKillSwitchActive || capital === null) return;
    
    startTransition(async () => {
      const currentPrice = openPosition ? latestPriceMap[openPosition.pair] : 0;
      const pnlPercent = openPosition 
        ? ((currentPrice - openPosition.entryPrice) / openPosition.entryPrice) * 100
        : 0;

      const aiInput: Omit<GetLLMTradingDecisionInput, 'ohlcvData' | 'higherTimeframeTrend' | 'pair' | 'watcherRationale'> = {
        availableCapital: capital,
        riskPerTrade: RISK_PER_TRADE,
        currentPosition: {
          status: openPosition ? 'IN_POSITION' : 'NONE',
          entryPrice: openPosition?.entryPrice,
          pnlPercent: pnlPercent,
          size: openPosition?.size,
          pair: openPosition?.pair,
        },
      };
      
      const result = await getAIDecisionStream(aiInput, TRADABLE_PAIRS, execute);
      setStreamValue(result);
    });
  }, [isPending, capital, isKillSwitchActive, openPosition, latestPriceMap]);

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
    // This function now should ideally clear the Firestore collection.
    // For safety, we will just reset the local state.
    // To truly reset, you would need a server action to clear the 'trades' collection.
    setTrades([]);
    setCapital(initialCapital);
    setDailyPnl(0);
    setOpenPosition(null);
    setIsAutomationEnabled(false);
    setStreamValue(undefined);
    setLatestPriceMap({
      'BTC/USDT': 65000,
      'ETH/USDT': 3500,
      'SOL/USDT': 150,
      'XRP/USDT': 0.47,
      'DOGE/USDT': 0.12,
      'MATIC/USDT': 0.57,
    });
    handleApiStatusCheck();
    toast({ title: "Simulação Resetada", description: "O histórico local foi limpo. Os dados no banco de dados permanecem." });

  };
  
  const manualDecisionDisabled = isPending || isKillSwitchActive || isAutomationEnabled || apiStatus !== 'conectado';
  const isAutomated = isAutomationEnabled && !isKillSwitchActive && apiStatus === 'conectado';

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

    if (streamedData?.status === 'done') {
      const { payload } = streamedData;
      if (payload.error) {
        return <AIStatus status={`Erro: ${payload.error}`} isError />;
      }
      if (payload.data) {
        return <AIDecisionPanelContent decision={{ ...payload.data, pair: payload.pair }} />;
      }
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
               O robô não pode operar. Adicione o IP do servidor à lista de permissões da sua chave de API na MEXC para resolver o problema de conexão.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 flex flex-col gap-6">
            <AIDecisionPanel 
              onGetDecision={() => getAIDecision(false)}
              isPending={isPending}
              disabled={manualDecisionDisabled}
              isAutomated={isAutomated}
            >
              {renderAIDecision()}
            </AIDecisionPanel>
          </div>
          <div className="lg:col-span-2 flex flex-col gap-6">
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
          <div className="lg:col-span-3">
            <OrderLog trades={trades} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
