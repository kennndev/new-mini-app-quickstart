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

const PLACEHOLDER_IMAGE = "https://assets.bcb.dev/base-miniapps/poke-placeholder.png";

type ElementOption = (typeof ELEMENT_OPTIONS)[number];
type FeedbackVariant = "muted" | "success" | "error";

interface StatsState {
  power: string;
  defense: string;
  aether: string;
}

const initialStats: StatsState = {
  power: "--",
  defense: "--",
  aether: "--",
};

function formatAddress(address: string | null): string {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function generateStats(seed: string) {
  let hash = 0;
  const normalized = `${seed}-${BASE_SEPOLIA_CHAIN_ID}`;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0;
  }
  const base = Math.abs(hash);
  return {
    power: 65 + (base % 36),
    defense: 58 + ((base >> 3) % 33),
    aether: 60 + ((base >> 5) % 28),
  };
}

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
  const userInspiration = `Trainer prompt: ${basePrompt}`;
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
  const [cardLevel, setCardLevel] = useState("LV.0");
  const [cardHash, setCardHash] = useState("Awaiting signature");
  const [stats, setStats] = useState<StatsState>(initialStats);
  const [moveDescription, setMoveDescription] = useState(
    "Forge an ally to unlock their legend. Generated art will appear here after creation.",
  );

  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadEnabled, setDownloadEnabled] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackVariant, setFeedbackVariant] = useState<FeedbackVariant>("muted");

  const appName = minikitConfig.miniapp?.name ?? "Cardify";
  const greeting = context?.user?.displayName ? `${context.user.displayName}` : "Trainer";

  const theme = useMemo(
    () => TYPE_THEME[elementType] ?? { color: "#f4f8ff", accent: "rgba(255,255,255,0.18)" },
    [elementType],
  );

  useEffect(() => {
    if (!isFrameReady) {
      setFrameReady();
    }
  }, [isFrameReady, setFrameReady]);

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

      setIsGenerating(true);
      setDownloadEnabled(false);
      setFeedback("Summoning art from the aether…", "muted");

      try {
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
            meta: { creatureName, elementType, signatureMove },
          }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new Error(errorBody?.error ?? "Image generation failed.");
        }

        const data = await response.json();
        const generatedImage = data?.image;
        if (!generatedImage || typeof generatedImage !== "string") {
          throw new Error("No image returned from generator.");
        }

        const forgedStats = generateStats(`${creatureName}-${elementType}-${signatureMove}-${trainerPrompt}`);
        const level = Math.min(99, Math.round((forgedStats.power + forgedStats.defense + forgedStats.aether) / 3));
        const hash = await computeForgeHash(
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
        setCardLevel(`LV.${level}`);
        setStats({
          power: String(forgedStats.power),
          defense: String(forgedStats.defense),
          aether: String(forgedStats.aether),
        });
        setMoveDescription(trainerPrompt);
        setCardHash(`Forge hash ${hash.slice(0, 10)}…`);
        setDownloadEnabled(true);
        setFeedback("Success! Creature forged on Base inspiration.", "success");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to forge creature.";
        console.error(error);
        setFeedback(message, "error");
        setDownloadEnabled(false);
      } finally {
        setIsGenerating(false);
      }
    },
    [connected, creatureName, elementType, signatureMove, walletAddress, setFeedback],
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
      <section className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Image
              src="/icon.png"
              alt="Cardify"
              width={56}
              height={56}
              className={styles.brandLogo}
              priority
            />
            <div className={styles.brandTitle}>
              <h1>{appName}</h1>
              <p className={styles.tagline}>Welcome back, {greeting}! Ready to forge a legend?</p>
            </div>
          </div>
          <button
            type="button"
            className={styles.connectButton}
            onClick={handleConnect}
            disabled={connected}
          >
            {connected ? "Wallet Linked" : "Connect Wallet"}
          </button>
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
            <h2 className={styles.panelTitle}>Trainer Console</h2>
            <p className={styles.formHelper}>
              Describe your ally and we’ll craft the card using a curated Base Sepolia prompt.
            </p>

            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label htmlFor="creatureName">Creature Name</label>
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
            </section>

            <button className={styles.primaryButton} type="submit" disabled={isGenerating}>
              {isGenerating ? "Forging…" : "Forge Creature"}
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
                <span className={styles.level}>{cardLevel}</span>
              </header>

              <div className={styles.cardImage} style={{ boxShadow: `0 0 32px ${theme.accent}` }}>
                <Image
                  src={cardImage}
                  alt="Generated creature"
                  fill
                  sizes="(max-width: 520px) 90vw, 480px"
                  className={styles.cardImageAsset}
                  unoptimized
                />
              </div>

              <section className={styles.stats}>
                <div>
                  <span className={styles.statLabel}>Power</span>
                  <span className={styles.statValue}>{stats.power}</span>
                </div>
                <div>
                  <span className={styles.statLabel}>Defense</span>
                  <span className={styles.statValue}>{stats.defense}</span>
                </div>
                <div>
                  <span className={styles.statLabel}>Aether</span>
                  <span className={styles.statValue}>{stats.aether}</span>
                </div>
              </section>

              <div className={styles.moveBlock}>
                <h4>{signatureMove || "Signature Move"}</h4>
                <p>{moveDescription}</p>
              </div>

              <footer className={styles.cardFooter}>
                <span className={styles.footerTag}>Chain: Base Sepolia</span>
                <span className={styles.footerTag}>{cardHash}</span>
              </footer>
            </article>

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleDownload}
                disabled={!downloadEnabled}
              >
                Download Card
              </button>
              <p className={styles.tinyText}>Available after forging completes.</p>
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
