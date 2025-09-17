
"use client";

import { useState, useEffect, useCallback, useTransition, useRef } from "react";
import type { GetLLMTradingDecisionOutput, GetLLMTradingDecisionInput } from "@/ai/schemas";
import { getAIDecisionStream, checkApiStatus, getFullAccountBalances, executeTradeAction, getMyTrades, manualClosePosition } from "@/app/actions";
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


export type Position = {
  pair: string;
  entryPrice: number;
  size: number; // in USDT
  quantity: number; // amount of the asset
  stop_pct?: number;
  take_pct?: number;
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
const AUTO_TRADING_INTERVAL = 90000; // 90 seconds
const API_STATUS_CHECK_INTERVAL = 60000; // 60 seconds
const TRADABLE_PAIRS = ['XRP/USDT', 'DOGE/USDT', 'SHIB/USDT', 'PEPE/USDT'];
const TRADABLE_ASSETS = TRADABLE_PAIRS.map(p => p.split('/')[0]);
const MIN_ASSET_VALUE_USDT = 4.5; // Minimum value in USDT to be considered an active position
const DAILY_LOSS_LIMIT = -0.02; // -2% daily loss limit
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
  const [isClosing, startClosingTransition] = useTransition();
  const [apiStatus, setApiStatus] = useState<ApiStatus>('verificando');
  const [streamValue, setStreamValue] = useState<StreamableValue<any>>();
  const [streamedData] = useStreamableValue(streamValue);
  const [lastDecision, setLastDecision] = useState<StreamPayload>(null);

  const { toast } = useToast();

  const automationRef = useRef(isAutomationEnabled);
  useEffect(() => {
    automationRef.current = isAutomationEnabled;
  }, [isAutomationEnabled]);
  
  const openPositionRef = useRef(openPosition);
  useEffect(() => {
    openPositionRef.current = openPosition;
  }, [openPosition]);

  const dailyLossPercent = capital && initialCapital ? dailyPnl / initialCapital : 0;
  const isKillSwitchActive = dailyLossPercent <= DAILY_LOSS_LIMIT;
  
  const latestPrice = openPosition ? latestPriceMap[openPosition.pair] : (latestPriceMap['BTC/USDT']);
  
  // Listen for trades from Firestore
  useEffect(() => {
    const q = query(collection(db, "trades"), orderBy("timestamp", "asc"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const tradesData: Trade[] = querySnapshot.docs.map(doc => {
          const data = doc.data() as FirestoreTrade;
           return {
              ...data,
              id: doc.id,
              timestamp: data.timestamp ? data.timestamp.toDate() : new Date(),
          };
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
  
  // Recalculate daily PNL from trade history
  useEffect(() => {
    let pnlToday = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const trade of trades) {
      if (trade.status === 'Fechada' && trade.pnl && trade.timestamp >= today) {
        pnlToday += trade.pnl;
      }
    }
    setDailyPnl(pnlToday);
  }, [trades]);

 const fetchBalancesAndPosition = useCallback(async () => {
    try {
        const balances = await getFullAccountBalances();
        if (!balances) {
            console.warn("Não foi possível buscar balanços da exchange.");
            if (capital === null) {
                setInitialCapital(18);
                setCapital(18); 
            }
            return;
        }

        const usdtBalance = balances.find((b: { asset: string; }) => b.asset === 'USDT');
        let usdtAmount = usdtBalance ? parseFloat(usdtBalance.free) : 0;
        
        let assetsValue = 0;
        let currentPosition: Position | null = null;
        
        const mexcTradesMap = new Map<string, any[]>();

        for (const asset of TRADABLE_ASSETS) {
            const assetBalance = balances.find((b: { asset: string }) => b.asset === asset);
            if (assetBalance) {
                const amountInWallet = parseFloat(assetBalance.free);
                const pair = `${asset}/USDT`;
                // Use a local, up-to-date price map for calculation
                const price = (window as any).latestPriceMap[pair] || 0;
                const valueInUsdt = amountInWallet * price;
                
                if (valueInUsdt > MIN_ASSET_VALUE_USDT) {
                    assetsValue += valueInUsdt;
                    
                    if (!mexcTradesMap.has(pair)) {
                        mexcTradesMap.set(pair, await getMyTrades(pair));
                    }
                    const pairTrades = mexcTradesMap.get(pair) || [];

                    if (pairTrades.length === 0) {
                         console.warn(`Ativo ${asset} encontrado, mas sem histórico de compra na MEXC.`);
                         currentPosition = { pair, quantity: amountInWallet, entryPrice: 0, size: valueInUsdt };
                         continue;
                    }
                    
                    const lastSellIndex = pairTrades.findIndex((t: any) => !t.isBuyer);
                    const positionTrades = (lastSellIndex === -1 
                        ? pairTrades.filter((t: any) => t.isBuyer)
                        : pairTrades.slice(0, lastSellIndex).filter((t: any) => t.isBuyer)
                    ).reverse(); // oldest first

                    if (positionTrades.length > 0) {
                        const totalCost = positionTrades.reduce((sum: number, t: any) => sum + parseFloat(t.quoteQty), 0);
                        const totalQuantity = positionTrades.reduce((sum: number, t: any) => sum + parseFloat(t.qty), 0);
                        const averagePrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
                        
                        currentPosition = {
                            pair: pair,
                            quantity: amountInWallet,
                            entryPrice: averagePrice,
                            size: totalCost,
                        };

                    } else {
                        console.warn(`Ativo ${asset} encontrado, mas sem histórico de compra correspondente.`);
                        currentPosition = { pair: pair, quantity: amountInWallet, entryPrice: 0, size: valueInUsdt };
                    }
                    break; 
                }
            }
        }
        
        setOpenPosition(currentPosition);
        
        const totalCapital = usdtAmount + assetsValue;
        
        setCapital(totalCapital);
        if (initialCapital === null && totalCapital > 0) {
            setInitialCapital(totalCapital);
        }

    } catch (e) {
        console.error("Falha ao buscar saldo ou definir posição:", e);
        toast({
            variant: "destructive",
            title: "Erro de Sincronização",
            description: e instanceof Error ? e.message : "Não foi possível obter saldos da conta.",
        });
        if (capital === null) {
          setInitialCapital(18);
          setCapital(18);
        }
    }
  }, [toast, capital, initialCapital]);

  useEffect(() => {
    // Make price map available globally for fetchBalancesAndPosition
    (window as any).latestPriceMap = latestPriceMap;
  }, [latestPriceMap]);


  const handleApiStatusCheck = useCallback(async () => {
    try {
        const status = await checkApiStatus();
        setApiStatus(status);
        if (status === 'desconectado') {
             toast({
                variant: "destructive",
                title: "API Desconectada",
                description: "Não foi possível conectar à API da MEXC.",
            });
        }
    } catch (e) {
        console.error("Falha ao checar status da API:", e);
        setApiStatus('desconectado');
    }
  }, [toast]);

  // Effect for API status checking (runs once on mount)
  useEffect(() => {
    handleApiStatusCheck(); 
    const intervalId = setInterval(handleApiStatusCheck, API_STATUS_CHECK_INTERVAL);
    return () => clearInterval(intervalId);
  }, [handleApiStatusCheck]);

  // Effect to fetch balances initially when API connects
  useEffect(() => {
    if (apiStatus === 'conectado') {
      fetchBalancesAndPosition();
    }
  }, [apiStatus, fetchBalancesAndPosition]);


  const handleNewDecision = useCallback(async (decision: GetLLMTradingDecisionOutput, executionResult: any, newLatestPrice: number) => {
    if (decision.pair && decision.pair !== 'NONE') {
        setLatestPriceMap(prev => ({...prev, [decision.pair]: newLatestPrice}));
        setLastAnalysisTimestamp(prev => ({...prev, [decision.pair]: Date.now() }));
    }
    
    const saveTrade = async (tradeData: Omit<Trade, 'id' | 'timestamp'>) => {
        try {
            await addDoc(collection(db, "trades"), { ...tradeData, timestamp: serverTimestamp() });
        } catch (error) {
            console.error("Erro ao salvar trade no Firestore: ", error);
            toast({ variant: "destructive", title: "Erro de DB", description: "Falha ao salvar operação." });
        }
    };

    if (decision.action === "HOLD" || executionResult?.success === false) {
      const rationale = executionResult?.success === false ? `Falha na Execução: ${executionResult.message}` : decision.rationale;
      await saveTrade({
        pair: decision.pair, action: decision.action, price: newLatestPrice, notional: 0, pnl: 0,
        rationale: rationale, status: executionResult?.success === false ? "Falhou" : "Registrada",
      });

       if (executionResult?.success === false) {
        toast({ variant: "destructive", title: "Falha na Execução", description: executionResult.message });
      }
      return;
    }
    
    if (!executionResult?.orderId && decision.action !== 'HOLD') {
        await saveTrade({
            pair: decision.pair, action: decision.action, price: newLatestPrice, notional: 0, pnl: 0,
            rationale: executionResult?.message || `Execução ignorada no modo simulação.`, status: "Registrada",
        });
        return;
    }
    
    toast({
        title: `Ordem Executada: ${decision.action} ${decision.pair}`,
        description: `Notional: $${decision.notional_usdt.toFixed(2)} @ $${newLatestPrice.toFixed(4)}`,
        action: <CheckCircle className="text-green-500" />,
    });
    
    // This logic relies on a ref, which is updated by a separate useEffect
    const currentPos = openPositionRef.current;
    if (currentPos && currentPos.pair === decision.pair && decision.action === 'SELL') {
        const pnl = (newLatestPrice - currentPos.entryPrice) * (currentPos.quantity);
        await saveTrade({
            pair: decision.pair, action: decision.action, price: newLatestPrice, notional: currentPos.size,
            pnl: parseFloat(pnl.toFixed(2)), rationale: `FECHAMENTO (IA): ${decision.rationale}`, status: "Fechada",
            stop_pct: currentPos.stop_pct, take_pct: currentPos.take_pct,
        });
    } else if (!currentPos && decision.action === 'BUY') {
        await saveTrade({
            pair: decision.pair, action: decision.action, price: newLatestPrice, notional: decision.notional_usdt,
            pnl: 0, rationale: `ABERTURA: ${decision.rationale}`, status: "Aberta",
            stop_pct: decision.stop_pct, take_pct: decision.take_pct,
        });
    }
    // Await a brief moment then refresh balances
    await new Promise(resolve => setTimeout(resolve, 2000));
    await fetchBalancesAndPosition();
  }, [toast, fetchBalancesAndPosition]);
  
   useEffect(() => {
    if (!streamedData) return;

    if (streamedData.status === 'done') {
      const payload: StreamPayload = streamedData.payload;
      if (payload?.error) {
        toast({ variant: 'destructive', title: 'Erro da IA', description: payload.error });
         setLastDecision(null);
      } else if (payload?.data && payload.latestPrice !== null && payload.pair) {
        const isManagingPosition = openPositionRef.current !== null && !automationRef.current;

        if (automationRef.current || isManagingPosition) {
          handleNewDecision(payload.data, payload.executionResult, payload.latestPrice);
          setLastDecision(null);
        } else { 
          setLastDecision(payload);
        }
      }
    } else if (streamedData.status === 'analyzing') {
       setLastDecision(null);
    }
  }, [streamedData, handleNewDecision, toast]);

  const getAIDecision = useCallback((execute: boolean = false) => {
    if(isPending || isKillSwitchActive || capital === null) return;
    
    startTransition(async () => {
      const currentPos = openPositionRef.current ? {
          status: 'IN_POSITION',
          entryPrice: openPositionRef.current.entryPrice,
          size: openPositionRef.current.size,
          pair: openPositionRef.current.pair,
      } : { status: 'NONE' };

      const aiInputBase: Pick<GetLLMTradingDecisionInput, 'availableCapital' | 'currentPosition'> = {
        availableCapital: capital,
        currentPosition: currentPos as any, 
      };

      const now = Date.now();
      let pairsToAnalyze;

      if (openPositionRef.current) {
        pairsToAnalyze = [openPositionRef.current.pair];
      } else {
        pairsToAnalyze = TRADABLE_PAIRS.filter(pair => {
            const lastAnalyzed = lastAnalysisTimestamp[pair] || 0;
            return now - lastAnalyzed > COOLDOWN_PERIOD;
        });
      }

      if (pairsToAnalyze.length === 0) {
          console.log("Nenhum par para analisar (em cool-down ou posição já sendo gerenciada).");
          if (streamValue) setStreamValue(undefined); 
          setLastDecision(null);
          return;
      }
      
      const result = await getAIDecisionStream(aiInputBase, pairsToAnalyze, execute);
      setStreamValue(result);
    });
  }, [isPending, capital, isKillSwitchActive, lastAnalysisTimestamp, streamValue]);
  
  // --- Automation Effect (Corrected) ---
  useEffect(() => {
    let timer: NodeJS.Timeout;
    let cancelled = false;

    const tick = () => {
        if (cancelled) return;
        
        // Read the latest state from refs to avoid dependency loops
        const isCurrentlyAutomated = automationRef.current || (openPositionRef.current !== null && !automationRef.current);
        
        if (isCurrentlyAutomated && !isKillSwitchActive && apiStatus === 'conectado') {
             getAIDecision(automationRef.current);
        }
        
        if (!cancelled) {
            timer = setTimeout(tick, AUTO_TRADING_INTERVAL);
        }
    };

    // We start the first tick only when the API is connected.
    if (apiStatus === 'conectado') {
        tick();
    }

    return () => {
        cancelled = true;
        clearTimeout(timer);
    };
  }, [isKillSwitchActive, apiStatus, getAIDecision]); 
  
  
  const handleExecuteManual = useCallback(async () => {
    if (!lastDecision || !lastDecision.data || isExecuting) return;

    startExecutingTransition(async () => {
      try {
        const executionResult = await executeTradeAction(lastDecision.data);
        await handleNewDecision(lastDecision.data, executionResult, lastDecision.latestPrice);
        setLastDecision(null);
      } catch (error) {
         console.error("Erro na execução manual:", error);
         toast({ variant: "destructive", title: "Erro de Execução", description: error instanceof Error ? error.message : "Ocorreu um erro." });
      }
    });

  }, [lastDecision, isExecuting, handleNewDecision, toast]);
  
  const handleManualClose = useCallback(async () => {
    if (!openPosition || isClosing) return;

    startClosingTransition(async () => {
      try {
        const result = await manualClosePosition(openPosition);
        if (result.success) {
          toast({
            title: `Posição Fechada: ${openPosition.pair}`,
            description: `Venda de ${result.closedQuantity} executada. PnL: $${result.pnl?.toFixed(2)}`,
            action: <CheckCircle className="text-green-500" />,
          });
          await fetchBalancesAndPosition();
        } else {
          throw new Error(result.message || "Erro desconhecido ao fechar posição.");
        }
      } catch (error) {
        console.error("Erro no fecho manual:", error);
        toast({ variant: "destructive", title: "Erro de Fecho Manual", description: error instanceof Error ? error.message : "Ocorreu um erro." });
      }
    });
  }, [openPosition, isClosing, toast, fetchBalancesAndPosition]);


  const resetSimulation = () => {
    setTrades([]);
    setInitialCapital(null); 
    setCapital(null);
    setDailyPnl(0);
    setOpenPosition(null);
    setIsAutomationEnabled(false);
    if(streamValue) setStreamValue(undefined);
    setLastAnalysisTimestamp({});
    setLastDecision(null);
    setLatestPriceMap({
      'BTC/USDT': 65000, 'ETH/USDT': 3500, 'SOL/USDT': 150,
      'XRP/USDT': 0.47, 'DOGE/USDT': 0.12, 'SHIB/USDT': 0.00002, 'PEPE/USDT': 0.00001,
    });
    handleApiStatusCheck(); 
    toast({ title: "Simulação Resetada", description: "O estado local foi reiniciado." });
  };
  
  const onAutomationToggle = useCallback((checked: boolean) => {
      setIsAutomationEnabled(checked);
      setLastDecision(null); // Clear last decision when toggling mode
      if (!checked && streamValue) {
        setStreamValue(undefined);
      }
  }, [streamValue]);

  const manualDecisionDisabled = isPending || isKillSwitchActive || isAutomationEnabled || apiStatus !== 'conectado' || isExecuting;
  const isAutomated = (isAutomationEnabled || openPosition !== null) && !isKillSwitchActive && apiStatus === 'conectado';
  const showExecuteButton = !isAutomationEnabled && lastDecision && lastDecision.data && (lastDecision.data.action === 'BUY' || lastDecision.data.action === 'SELL');

  const renderAIDecision = () => {
    if (streamedData?.status === 'analyzing') {
      return <AnalysisGrid pairs={TRADABLE_PAIRS} currentlyAnalyzing={streamedData.payload.pair} statusText={streamedData.payload.text} />;
    }
    
    const decisionToRender = lastDecision?.data;

    if (decisionToRender) {
      return <AIDecisionPanelContent decision={decisionToRender} />;
    }

    if (streamedData?.status === 'done' && streamedData.payload.error) {
        return <AIStatus status={`Erro: ${streamedData.payload.error}`} isError />;
    }
    
    if (!isAutomationEnabled && openPosition) {
        return <AIStatus status={`Monitorando ${openPosition.pair} para fechamento...`} />;
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
                onCheckedChange={onAutomationToggle}
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
              As operações foram desativadas por atingir o limite de perda diária.
            </AlertDescription>
          </Alert>
        )}
        {apiStatus === 'desconectado' && !isKillSwitchActive && (
           <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>API Desconectada</AlertTitle>
            <AlertDescription>
               O robô não pode operar. Verifique as chaves de API no ambiente.
            </AlertDescription>
          </Alert>
        )}
         {isAutomationEnabled && !isKillSwitchActive && apiStatus === 'conectado' && (
           <Alert variant="default" className="bg-blue-600/10 border-blue-600/30 text-blue-400 [&>svg]:text-blue-400">
            <Bot className="h-4 w-4" />
            <AlertTitle>Modo Autônomo Ativo</AlertTitle>
            <AlertDescription>
               O robô está a operar em segundo plano. As decisões serão executadas automaticamente.
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
                onManualClose={handleManualClose}
                isClosing={isClosing}
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
