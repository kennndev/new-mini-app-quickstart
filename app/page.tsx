"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useMiniKit } from "@coinbase/onchainkit/minikit";
import { minikitConfig } from "../minikit.config";
import styles from "./page.module.css";

const BASE_SEPOLIA_CHAIN_ID = "0x14a34";


const BASE_SEPOLIA_PARAMS = {
  chainId: BASE_SEPOLIA_CHAIN_ID,
  chainName: "Base Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
};

type EthereumRequestArgs = {
  method: string;
  params?: unknown[];
};

type EthereumProvider = {
  request?: (args: EthereumRequestArgs) => Promise<unknown>;
};

type SmartWalletResponse = {
  address?: string | null;
};

type MiniAppSession = {
  accounts?: string[];
  chainId?: string;
};

type MiniAppBridge = {
  connect?: (options?: { chainId?: string }) => Promise<MiniAppSession | undefined>;
  disconnect?: () => Promise<void>;
  session?: MiniAppSession;
  smartWallet?: {
    getSmartWallet?: () => Promise<SmartWalletResponse | null | undefined>;
  };
  switchEthereumChain?: (chainId: string) => Promise<void>;
};

type MiniAppWindow = Window &
  typeof globalThis & {
    coinbaseWalletMiniApp?: MiniAppBridge;
    ethereum?: EthereumProvider;
  };

const TYPE_THEME: Record<
  string,
  {
    color: string;
    accent: string;
  }
> = {
  Electric: { color: "#f7e86d", accent: "rgba(247, 232, 109, 0.28)" },
  Water: { color: "#6de4f7", accent: "rgba(109, 228, 247, 0.28)" },
  Fire: { color: "#ff9d65", accent: "rgba(255, 142, 84, 0.28)" },
  Grass: { color: "#7bf0a2", accent: "rgba(123, 240, 162, 0.28)" },
  Psychic: { color: "#f76ddf", accent: "rgba(247, 109, 223, 0.28)" },
  Ice: { color: "#97dbff", accent: "rgba(151, 219, 255, 0.28)" },
  Dragon: { color: "#c2a7ff", accent: "rgba(194, 167, 255, 0.28)" },
  Steel: { color: "#b9d0e8", accent: "rgba(185, 208, 232, 0.32)" },
  Fairy: { color: "#ffafd4", accent: "rgba(255, 175, 212, 0.28)" },
  Shadow: { color: "#a48fff", accent: "rgba(164, 143, 255, 0.32)" },
};

const FRAME_STYLE = {
  framePrompt:
    "Use a classic trading-card layout that fills the entire image, edge-to-edge. Include a bold header bar with the creature name, a small stage capsule in the top-left, an HP display in the top-right, and a semi-transparent attack panel along the lower third.",
  textPrompt:
    "Display one attack line with small energy icons, a damage number, and a weakness/resistance/retreat strip across the bottom. Keep overlays minimal and clearly legible.",
};

const ART_STYLE = {
  stylePrompt:
    "vibrant anime style, cel-shaded, clean lines, cute creature aesthetic, bright saturated colors, luminous rim lighting, dynamic energetic pose",
};

const ELEMENT_OPTIONS = [
  "Electric",
  "Water",
  "Fire",
  "Grass",
  "Psychic",
  "Ice",
  "Dragon",
  "Steel",
  "Fairy",
  "Shadow",
] as const;


type ElementOption = (typeof ELEMENT_OPTIONS)[number];
type FeedbackVariant = "muted" | "success" | "error";

function formatAddress(address: string | null): string {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const PLACEHOLDER_IMAGE = "/placeholder.jpg";
const ESTIMATED_GENERATION_SECONDS = 45;
const LOADER_GAUGE_RADIUS = 52;
const LOADER_GAUGE_CIRCUMFERENCE = 2 * Math.PI * LOADER_GAUGE_RADIUS;

function composeTrainerPrompt({
  creatureName,
  elementType,
  signatureMove,
}: {
  creatureName: string;
  elementType: string;
  signatureMove: string;
}) {
  return `${creatureName} is a ${elementType.toLowerCase()}-type companion unleashing ${signatureMove} amid a cinematic battle. Highlight elemental energy, dramatic lighting, and a sense of motion.`;
}

function buildGenerationPrompt({
  basePrompt,
  creatureName,
  elementType,
  signatureMove,
}: {
  basePrompt: string;
  creatureName: string;
  elementType: string;
  signatureMove: string;
}) {
  const intro =
    "Create a full-bleed trading card artwork that extends to every edge with sharp 90-degree corners. Portrait orientation 2.5:3.5.";
  const subject = `Subject: ${creatureName}, a ${elementType.toLowerCase()}-type companion performing the signature move "${signatureMove}".`;
  const userInspiration = `prompt: ${basePrompt}`;
  const style = `Art style: ${ART_STYLE.stylePrompt}.`;
  const frame = `Frame implementation: ${FRAME_STYLE.framePrompt}`;
  const textLayout = `Card text elements: ${FRAME_STYLE.textPrompt}`;
  const breakout =
    "Add a dramatic breakout where the creature slightly overlaps the frame while background energy remains inside.";
  const palette =
    "Palette: luminous, high-contrast lighting emphasizing the elemental aura with particles/sparks/mist matching the typing.";
  const clarity =
    "Typography clarity: keep overlays clean, avoid extra logos/copyright/artist text, and do not render the card as a 3D object in space.";

  return [intro, subject, userInspiration, style, frame, textLayout, breakout, palette, clarity].join(
    "\n\n",
  );
}

async function computeForgeHash(payload: string) {
  const encoded = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureWalletOnBaseSepolia(provider: EthereumProvider) {
  if (!provider?.request) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }],
    });
  } catch (error) {
    const err = error as { code?: number; message?: string };
    if (err?.code === 4902 || err?.message?.includes("not found")) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [BASE_SEPOLIA_PARAMS],
      });
    } else {
      throw err ?? error;
    }
  }
}

export default function Home() {
  const { isFrameReady, setFrameReady, context } = useMiniKit();

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [smartWallet, setSmartWallet] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const [creatureName, setCreatureName] = useState("");
  const [elementType, setElementType] = useState<ElementOption>("Electric");
  const [signatureMove, setSignatureMove] = useState("");

  const [cardName, setCardName] = useState("???");
  const [cardImage, setCardImage] = useState(PLACEHOLDER_IMAGE);
const [cardHash, _setCardHash] = useState("Awaiting signature");
  const [moveDescription, setMoveDescription] = useState(
    "Forge an ally to unlock their legend. Generated art will appear here after creation.",
  );

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [downloadEnabled, setDownloadEnabled] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackVariant, setFeedbackVariant] = useState<FeedbackVariant>("muted");
  const [showConfetti, setShowConfetti] = useState(false);

  const appName = minikitConfig.miniapp?.name ?? "Cardify";
  const greeting = context?.user?.displayName ? `${context.user.displayName}` : "";

  const theme = useMemo(
    () => TYPE_THEME[elementType] ?? { color: "#f4f8ff", accent: "rgba(255,255,255,0.18)" },
    [elementType],
  );

  const clampedElapsed = Math.max(0, Math.min(generationElapsed, 599));
  const generationProgress = Math.min(generationElapsed / ESTIMATED_GENERATION_SECONDS, 1);
  const progressPercent = Math.min(Math.round(generationProgress * 100), 100);
  const timerMinutes = Math.floor(clampedElapsed / 60)
    .toString()
    .padStart(2, "0");
  const timerSeconds = (clampedElapsed % 60).toString().padStart(2, "0");
  const timerLabel = `${timerMinutes}:${timerSeconds}`;
  const estimatedRemaining = Math.max(ESTIMATED_GENERATION_SECONDS - generationElapsed, 0);
  const loaderStatus =
    generationProgress < 1
      ? `~${estimatedRemaining}s remaining | ${progressPercent}%`
      : "Finishing touches...";
  const loaderStrokeDashoffset = Math.max(0, LOADER_GAUGE_CIRCUMFERENCE * (1 - generationProgress));

  useEffect(() => {
    if (!isFrameReady) {
      setFrameReady();
    }
  }, [isFrameReady, setFrameReady]);

  useEffect(() => {
    if (!isGenerating) {
      setGenerationElapsed(0);
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    setGenerationElapsed(0);
    const start = Date.now();
    const intervalId = window.setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - start) / 1000);
      setGenerationElapsed(elapsedSeconds);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isGenerating]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { coinbaseWalletMiniApp } = window as MiniAppWindow;
    if (!coinbaseWalletMiniApp?.session) return;

    const session = coinbaseWalletMiniApp.session;
    const accounts = session?.accounts ?? [];
    const existingAddress = accounts[0] ?? null;
    setWalletAddress(existingAddress);
    setConnected(Boolean(existingAddress));
    setNetwork(session?.chainId ? `Chain ${session.chainId}` : "Base Sepolia");

    const fetchSmartWallet = async () => {
      try {
        const response = await coinbaseWalletMiniApp.smartWallet?.getSmartWallet?.();
        if (response && typeof response === "object") {
          const { address } = response as SmartWalletResponse;
          setSmartWallet(address ?? null);
        }
      } catch (smartWalletError) {
        console.warn("Smart wallet lookup failed", smartWalletError);
      }
    };

    void fetchSmartWallet();
  }, []);

  const setFeedback = useCallback((message: string, variant: FeedbackVariant = "muted") => {
    setFeedbackMessage(message);
    setFeedbackVariant(variant);
  }, []);

  const handleConnect = useCallback(async () => {
    if (typeof window === "undefined") return;
    const { coinbaseWalletMiniApp, ethereum } = window as MiniAppWindow;

    try {
      if (coinbaseWalletMiniApp?.connect) {
        const session = await coinbaseWalletMiniApp.connect({ chainId: BASE_SEPOLIA_CHAIN_ID });
        const accounts = session?.accounts ?? [];
        const address = accounts[0] ?? null;
        setWalletAddress(address);
        setConnected(Boolean(address));
        const chainId = session?.chainId ?? BASE_SEPOLIA_CHAIN_ID;
        setNetwork(chainId.toLowerCase() === BASE_SEPOLIA_CHAIN_ID ? "Base Sepolia" : `Chain ${chainId}`);

        if (chainId?.toLowerCase() !== BASE_SEPOLIA_CHAIN_ID && coinbaseWalletMiniApp.switchEthereumChain) {
          await coinbaseWalletMiniApp.switchEthereumChain(BASE_SEPOLIA_CHAIN_ID);
          setNetwork("Base Sepolia");
        }

        try {
          const response = await coinbaseWalletMiniApp.smartWallet?.getSmartWallet?.();
          if (response && typeof response === "object") {
            const { address: smartWalletAddress } = response as SmartWalletResponse;
            setSmartWallet(smartWalletAddress ?? null);
          }
        } catch (smartWalletError) {
          console.warn("Smart wallet lookup failed", smartWalletError);
        }

        setFeedback("Wallet connected.", "success");
        return;
      }

      if (ethereum?.request) {
        const accountsResult = await ethereum.request({ method: "eth_requestAccounts" });
        const accounts = Array.isArray(accountsResult) ? (accountsResult as string[]) : [];
        const address = accounts[0] ?? null;
        setWalletAddress(address);
        setConnected(Boolean(address));

        await ensureWalletOnBaseSepolia(ethereum);
        const chainIdResult = await ethereum.request({ method: "eth_chainId" });
        const chainId =
          typeof chainIdResult === "string" ? chainIdResult : BASE_SEPOLIA_CHAIN_ID;
        setNetwork(chainId.toLowerCase() === BASE_SEPOLIA_CHAIN_ID ? "Base Sepolia" : `Chain ${chainId}`);
        setFeedback("Wallet connected.", "success");
        return;
      }

      setFeedback("Wallet provider not detected in this environment.", "error");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to connect wallet.";
      console.error(error);
      setFeedback(message, "error");
    }
  }, [setFeedback]);

  const handleDisconnect = useCallback(async () => {
    if (typeof window === "undefined") return;
    const { coinbaseWalletMiniApp } = window as MiniAppWindow;

    try {
      await coinbaseWalletMiniApp?.disconnect?.();
    } catch (error) {
      console.warn("Mini app disconnect failed", error);
    }

    setWalletAddress(null);
    setNetwork(null);
    setSmartWallet(null);
    setConnected(false);
    setFeedback("Wallet disconnected.", "muted");
  }, [setFeedback]);

  const handlePayment = useCallback(async () => {
    if (typeof window === "undefined") {
      throw new Error("Window not available");
    }
    
    if (!walletAddress) {
      throw new Error("Wallet not connected");
    }
    
    const { ethereum } = window as MiniAppWindow;
    if (!ethereum?.request) {
      throw new Error("Ethereum provider not available");
    }

    try {
      // USDC contract on Base Sepolia
      const usdcContract = process.env.NEXT_PUBLIC_USDC_CONTRACT || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
      const receivingWallet = process.env.NEXT_PUBLIC_RECEIVING_WALLET_ADDRESS || "0xD0D2e2206E44f818006ebC19F2fDB16a80a0d1fB";
      const amount = "1000000"; // $1 USDC (6 decimals)
      
 
      
      
      // First, check USDC balance
      const balanceData = `0x70a08231${walletAddress.slice(2).padStart(64, '0')}`;
      const balance = await ethereum.request({
        method: "eth_call",
        params: [{
          to: usdcContract,
          data: balanceData
        }]
      });

      const currentBalance = parseInt(balance, 16);
      
      if (currentBalance < parseInt(amount)) {
        throw new Error("Insufficient USDC balance");
      }

      // Check allowance
      const allowanceData = `0xdd62ed3e${walletAddress.slice(2).padStart(64, '0')}${receivingWallet.slice(2).padStart(64, '0')}`;
      const allowance = await ethereum.request({
        method: "eth_call",
        params: [{
          to: usdcContract,
          data: allowanceData
        }]
      });

      const currentAllowance = parseInt(allowance, 16);

      // If allowance is insufficient, approve first
      if (currentAllowance < parseInt(amount)) {
        const approveData = `0x095ea7b3${receivingWallet.slice(2).padStart(64, '0')}${parseInt(amount).toString(16).padStart(64, '0')}`;
        
        await ethereum.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: usdcContract,
            data: approveData,
          }],
        });
        
        // Wait for approval to be mined
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // Now transfer USDC
      const transferData = `0xa9059cbb${receivingWallet.slice(2).padStart(64, '0')}${parseInt(amount).toString(16).padStart(64, '0')}`;
      
      const txHash = await ethereum.request({
        method: "eth_sendTransaction",
        params: [{
          from: walletAddress,
          to: usdcContract,
          data: transferData,
        }],
      });


      if (!txHash || typeof txHash !== "string") {
        throw new Error("Failed to submit payment transaction.");
      }

      setFeedback("Waiting for payment confirmation...", "muted");

      const pollIntervalMs = 4000;
      const timeoutMs = 120000; // 2 minutes
      const start = Date.now();

      const wait = (ms: number) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        });

      while (Date.now() - start < timeoutMs) {
        try {
          const receipt = (await ethereum.request({
            method: "eth_getTransactionReceipt",
            params: [txHash],
          })) as { status?: string } | null;

          if (receipt) {
            const status = receipt.status?.toLowerCase();

            if (status === "0x1" || status === "1" || status === "success") {
              return txHash;
            }

            if (status === "0x0" || status === "0" || status === "failed") {
              throw new Error("Payment transaction failed on-chain.");
            }
          }
        } catch {
          // Continue polling unless timeout is reached.
        }

        await wait(pollIntervalMs);
      }

      throw new Error("Timed out waiting for payment confirmation.");
    } catch (error) {
      console.error("Payment failed:", error);
      throw error;
    }
  }, [setFeedback, walletAddress]);

  const handleForge = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFeedback("", "muted");

      if (!connected) {
        setFeedback("Connect your wallet on Base Sepolia first.", "error");
        return;
      }

      if (!creatureName.trim() || !signatureMove.trim()) {
        setFeedback("Name and signature move are required to forge your creature.", "error");
        return;
      }

      setDownloadEnabled(false);
      setFeedback("Processing payment of $1 USDC...", "muted");

      try {
        // First, process payment
        const paymentTxHash = await handlePayment();
        if (!paymentTxHash) {
          throw new Error("Payment failed");
        }

        // Only start generation timer after payment is confirmed
        setIsGenerating(true);
        setFeedback("Payment confirmed! Generating your creature...", "muted");

        const trainerPrompt = composeTrainerPrompt({
          creatureName,
          elementType,
          signatureMove,
        });
        const enrichedPrompt = buildGenerationPrompt({
          basePrompt: trainerPrompt,
          creatureName,
          elementType,
          signatureMove,
        });

        const response = await fetch("/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: enrichedPrompt,
            walletAddress,
            paymentTxHash,
            meta: { creatureName, elementType, signatureMove },
          }),
        });

        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data?.error || "Image generation failed.");
        }
        
        const generatedImage = data?.image;
        if (!generatedImage || typeof generatedImage !== "string") {
          throw new Error("No image returned from generator.");
        }

        const _hash = await computeForgeHash(
          JSON.stringify({
            address: walletAddress,
            name: creatureName,
            prompt: enrichedPrompt,
            type: elementType,
            move: signatureMove,
            timestamp: Date.now(),
          }),
        );

        setCardName(creatureName);
        setCardImage(generatedImage);
        setMoveDescription(trainerPrompt);
        setDownloadEnabled(true);
        setFeedback("Success! Creature forged on Base inspiration.", "success");
        
        // Trigger confetti blast
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to forge creature.";
        console.error(error);
        setFeedback(message, "error");
        setDownloadEnabled(false);
      } finally {
        setIsGenerating(false);
      }
    },
    [connected, creatureName, elementType, signatureMove, walletAddress, setFeedback, handlePayment],
  );

  const handleDownload = useCallback(() => {
    if (!downloadEnabled || !cardImage) return;
    const safeName = (cardName || "cardify-creature").replace(/\s+/g, "_");
    const anchor = document.createElement("a");
    anchor.href = cardImage;
    anchor.download = `${safeName}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, [downloadEnabled, cardImage, cardName]);

  return (
    <main className={styles.container}>
      {showConfetti && (
        <div className={styles.confettiBlast}>
          {Array.from({ length: 20 }, (_, i) => {
            const angle = (i * 18) % 360; // 20 pieces, 18 degrees apart
            const distance = 150 + Math.random() * 100; // Random distance between 150-250px
            return (
              <div 
                key={i} 
                className={styles.confetti}
                style={{
                  '--angle': `${angle}deg`,
                  '--distance': `${distance}px`,
                  animationDelay: `${i * 0.05}s`,
                } as React.CSSProperties}
              />
            );
          })}
        </div>
      )}
      <section className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Image
              src="/icon.png"
              alt="Cardify"
              width={56}
              height={56}
              className={styles.brandLogo}
              unoptimized
            />
            <div className={styles.brandTitle}>
              <h1>{appName}</h1>
              <p className={styles.tagline}>Welcome back {greeting}!</p>
            </div>
          </div>
          {connected ? (
            <button
              type="button"
              className={styles.disconnectButton}
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className={styles.connectButton}
              onClick={handleConnect}
            >
              Connect Wallet
            </button>
          )}
        </header>

        <section className={styles.statusStrip}>
          <div className={styles.statusRow}>
            <span className={styles.label}>Wallet</span>
            <span className={`${styles.value} ${!walletAddress ? styles.muted : ""}`}>
              {formatAddress(walletAddress)}
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.label}>Network</span>
            <span className={`${styles.value} ${!network || network === "Unknown" ? styles.muted : ""}`}>
              {network ?? "Unknown"}
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.label}>Smart wallet</span>
            <span className={`${styles.value} ${!smartWallet ? styles.muted : ""}`}>
              {smartWallet ? formatAddress(smartWallet) : connected ? "Pending…" : "Not provisioned"}
            </span>
          </div>
        </section>

        <section className={styles.layout}>
          <form className={styles.panel} onSubmit={handleForge}>
       
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label htmlFor="creatureName">Card Name</label>
                <input
                  id="creatureName"
                  className={styles.input}
                  type="text"
                  value={creatureName}
                  onChange={(event) => setCreatureName(event.target.value)}
                  placeholder="Voltflare"
                  required
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="elementType">Element Type</label>
                <select
                  id="elementType"
                  className={styles.select}
                  value={elementType}
                  onChange={(event) => setElementType(event.target.value as ElementOption)}
                >
                  {ELEMENT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="signatureMove">Signature Move</label>
              <input
                id="signatureMove"
                className={styles.input}
                type="text"
                value={signatureMove}
                onChange={(event) => setSignatureMove(event.target.value)}
                placeholder="Ion Cyclone"
                required
              />
            </div>

            <section className={styles.styleHints}>
              <div className={styles.stylePill}>
                <span className={styles.styleLabel}>Frame Style</span>
                <strong>Classic Monster TCG</strong>
                <p>Full-bleed layout with header bar, stage capsule, and attack overlays.</p>
              </div>
              <div className={styles.stylePill}>
                <span className={styles.styleLabel}>Art Style</span>
                <strong>Anime Cel-Shaded</strong>
                <p>Vibrant energy, bold outlines, and cinematic lighting.</p>
              </div>
              <div className={styles.stylePill}>
                <span className={styles.styleLabel}>Cost</span>
                <strong>$1 USDC</strong>
                <p>Pay with USDC on Base Sepolia to generate your creature.</p>
              </div>
            </section>

            <button className={styles.primaryButton} type="submit" disabled={isGenerating}>
              {isGenerating ? "Generating…" : "Pay $1 USDC & Forge Creature"}
            </button>
            <p
              className={`${styles.feedback} ${
                feedbackVariant === "success"
                  ? styles.feedbackSuccess
                  : feedbackVariant === "error"
                  ? styles.feedbackError
                  : ""
              }`}
            >
              {feedbackMessage}
            </p>
          </form>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Card Preview</h2>

            <article className={styles.card}>
              <header className={styles.cardHeader}>
                <div>
                  <h3 className={styles.cardName}>{cardName}</h3>
                  <span
                    className={styles.chip}
                    style={{ background: theme.accent, color: theme.color }}
                  >
                    Type: {elementType}
                  </span>
                </div>
                <span className={styles.level}></span>
              </header>

              <div 
                className={`${styles.cardImage} ${
                  isGenerating 
                    ? styles.generating 
                    : cardImage === PLACEHOLDER_IMAGE 
                    ? styles.placeholder 
              : ''
            }`} 
            style={{ boxShadow: `0 0 32px ${theme.accent}` }}
          >
  <Image
    src={cardImage && typeof cardImage === "string" && cardImage.trim() !== "" 
      ? cardImage 
      : PLACEHOLDER_IMAGE}
    alt={cardImage && cardImage !== PLACEHOLDER_IMAGE ? "Generated creature" : "Placeholder image"}
    fill
    sizes="(max-width: 520px) 90vw, 480px"
    className={styles.cardImageAsset}
    unoptimized
    onError={(e) => {
      // if image fails to load, replace with placeholder
      (e.currentTarget as HTMLImageElement).src = PLACEHOLDER_IMAGE;
    }}
  />
  {isGenerating && (
    <div className={styles.imageLoader}>
      <div className={styles.loaderMeter}>
        <svg
          className={styles.loaderGauge}
          viewBox="0 0 120 120"
          role="presentation"
          aria-hidden="true"
        >
          <circle className={styles.loaderGaugeTrack} cx="60" cy="60" r="52" />
          <circle
            className={styles.loaderGaugeProgress}
            cx="60"
            cy="60"
            r="52"
            style={{
              strokeDasharray: `${LOADER_GAUGE_CIRCUMFERENCE}`,
              strokeDashoffset: `${loaderStrokeDashoffset}`,
            }}
          />
        </svg>
        <div className={styles.loaderTimer}>
          <span className={styles.loaderSeconds}>{timerLabel}</span>
          <span className={styles.loaderEta}>{loaderStatus}</span>
        </div>
      </div>
      <p className={styles.loaderText}>
        Forging artwork...
        <span>Hanging tight while your creature materializes</span>
      </p>
    </div>
  )}
</div>

               <div className={styles.moveBlock}>
              <h4>{signatureMove || "Signature Move"}</h4>
              <p>{moveDescription}</p>
              </div>

              <footer className={styles.cardFooter}>
                <span className={styles.footerTag}>Chain: Base Sepolia</span>
                {downloadEnabled && cardImage !== PLACEHOLDER_IMAGE ? (
                  <button
                    type="button"
                    className={styles.downloadIcon}
                    onClick={handleDownload}
                    title="Download Card"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7,10 12,15 17,10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </button>
                ) : (
                  <span className={styles.footerTag}>{cardHash}</span>
                )}
              </footer>
            </article>

          </section>
        </section>
      </section>
    </main>
  );
}
