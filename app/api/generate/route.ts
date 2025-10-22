import { NextRequest, NextResponse } from "next/server";
import { parseEther } from "viem";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  const receivingWallet = process.env.RECEIVING_WALLET_ADDRESS || "0xD0D2e2206E44f818006ebC19F2fDB16a80a0d1fB";
  
  
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 }
    );
  }

  if (!receivingWallet) {
    return NextResponse.json(
      { error: "RECEIVING_WALLET is not configured." },
      { status: 500 }
    );
  }

  let body: { prompt?: string; walletAddress?: string; paymentTxHash?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const { prompt, walletAddress, paymentTxHash } = body;
  
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid prompt." },
      { status: 400 }
    );
  }

  if (!walletAddress || typeof walletAddress !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid wallet address." },
      { status: 400 }
    );
  }

  if (!paymentTxHash || typeof paymentTxHash !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid payment transaction hash." },
      { status: 400 }
    );
  }

  // Verify payment transaction
  try {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http()
    });

    const tx = await publicClient.getTransaction({ hash: paymentTxHash as `0x${string}` });
    
    if (!tx) {
      return NextResponse.json(
        { error: "Transaction not found." },
        { status: 400 }
      );
    }

    // Check if this is a USDC token transfer
    if (tx.input && tx.input !== "0x") {
      // This is a token transfer - decode the transfer data
      const transferSignature = "0xa9059cbb"; // transfer(address,uint256)
      
      if (tx.input.startsWith(transferSignature)) {
        
        // Extract the recipient and amount from the transaction data
        const recipientHex = tx.input.slice(34, 74); // Address is at position 34-74
        const amountHex = tx.input.slice(-64); // Last 32 bytes
        const transferAmount = parseInt(amountHex, 16);
        const recipientAddress = "0x" + recipientHex;
        
          
        // Check if recipient matches our receiving wallet (case-insensitive)
        if (recipientAddress.toLowerCase() !== receivingWallet.toLowerCase()) {
       
          return NextResponse.json(
            { error: "USDC transfer not sent to correct recipient." },
            { status: 400 }
          );
        }
        
        
        // Check if amount is at least $1 USDC (1,000,000 units with 6 decimals)
        const minUSDCAmount = 1000000;
     
        if (transferAmount < minUSDCAmount) {
          return NextResponse.json(
            { error: "USDC payment amount too low. Minimum $1 required." },
            { status: 400 }
          );
        }
        
      } else {
        return NextResponse.json(
          { error: "Invalid USDC transfer transaction." },
          { status: 400 }
        );
      }
    } else {
      // This is an ETH transfer, check if it's sent to the correct address
      if (tx.to?.toLowerCase() !== receivingWallet.toLowerCase()) {
        return NextResponse.json(
          { error: "ETH transfer not sent to correct recipient." },
          { status: 400 }
        );
      }
      
      // Check minimum ETH amount
      const minPayment = parseEther("0.0004");
      if (tx.value < minPayment) {
        return NextResponse.json(
          { error: "Payment amount too low. Minimum $1 required." },
          { status: 400 }
        );
      }
    }

    // Verify transaction is confirmed
    const receipt = await publicClient.getTransactionReceipt({ hash: paymentTxHash as `0x${string}` });
 
    
    if (!receipt || receipt.status !== "success") {
      return NextResponse.json(
        { error: "Payment transaction not confirmed." },
        { status: 400 }
      );
    }
    

  } catch (error) {
    console.error("Payment verification failed:", error);
    return NextResponse.json(
      { error: "Failed to verify payment." },
      { status: 400 }
    );
  }

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
        n: 1,
      }),
    });
    

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        data?.error?.message ??
        `OpenAI request failed with status ${response.status}.`;
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const base64 = data?.data?.[0]?.b64_json;
    if (!base64) {
      return NextResponse.json(
        { error: "OpenAI returned no image data." },
        { status: 502 }
      );
    }

    return NextResponse.json({ image: `data:image/png;base64,${base64}` });
  } catch (error) {
    console.error("Image generation error:", error);
    return NextResponse.json(
      { error: "Unexpected server error occurred." },
      { status: 500 }
    );
  }
}






