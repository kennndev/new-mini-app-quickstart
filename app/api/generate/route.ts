import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });
  }

  let body: { prompt?: string } = {};
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const prompt = body?.prompt;
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "Missing prompt." }, { status: 400 });
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
        size: "512x512",
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
      return NextResponse.json({ error: "OpenAI returned no image data." }, { status: 502 });
    }

    return NextResponse.json({ image: `data:image/png;base64,${base64}` });
  } catch (error) {
    console.error("[Cardify] generate error:", error);
    return NextResponse.json({ error: "Unexpected server error occurred." }, { status: 500 });
  }
}
