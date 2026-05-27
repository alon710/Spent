import { NextResponse } from "next/server";
import { RECOMMENDED_GEMINI_MODELS } from "@/lib/types";
import { getSetting, setSetting } from "@/server/db/queries/settings";
import { encrypt } from "@/server/lib/encryption";

function hasStoredKey(prefix: "ai_api_key" | "ai_gemini_key"): boolean {
  return (
    !!getSetting(`${prefix}_encrypted`) &&
    !!getSetting(`${prefix}_iv`) &&
    !!getSetting(`${prefix}_auth_tag`)
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    provider: "claude" | "gemini" | "ollama" | "none";
    claudeApiKey?: string;
    geminiApiKey?: string;
    geminiModel?: string;
    ollamaUrl?: string;
    ollamaModel?: string;
  };

  if (
    body.provider === "claude" &&
    !body.claudeApiKey &&
    !hasStoredKey("ai_api_key")
  ) {
    return NextResponse.json(
      { error: "Enter a Claude API key before selecting Claude." },
      { status: 400 }
    );
  }

  if (
    body.provider === "gemini" &&
    !body.geminiApiKey &&
    !hasStoredKey("ai_gemini_key")
  ) {
    return NextResponse.json(
      { error: "Enter a Gemini API key before selecting Gemini." },
      { status: 400 }
    );
  }

  if (
    body.provider === "gemini" &&
    body.geminiModel &&
    !RECOMMENDED_GEMINI_MODELS.some((model) => model.name === body.geminiModel)
  ) {
    return NextResponse.json(
      { error: "Choose a supported stable Gemini model." },
      { status: 400 }
    );
  }

  setSetting("ai_provider", body.provider);

  if (body.provider === "claude" && body.claudeApiKey) {
    const { encrypted, iv, authTag } = encrypt(body.claudeApiKey);
    setSetting("ai_api_key_encrypted", encrypted.toString("hex"));
    setSetting("ai_api_key_iv", iv.toString("hex"));
    setSetting("ai_api_key_auth_tag", authTag.toString("hex"));
  }

  if (body.provider === "gemini" && body.geminiApiKey) {
    const { encrypted, iv, authTag } = encrypt(body.geminiApiKey);
    setSetting("ai_gemini_key_encrypted", encrypted.toString("hex"));
    setSetting("ai_gemini_key_iv", iv.toString("hex"));
    setSetting("ai_gemini_key_auth_tag", authTag.toString("hex"));
  }

  if (body.provider === "gemini") {
    setSetting(
      "ai_gemini_model",
      body.geminiModel ?? RECOMMENDED_GEMINI_MODELS[0].name
    );
  }

  if (body.provider === "ollama") {
    if (body.ollamaUrl) setSetting("ai_ollama_url", body.ollamaUrl);
    if (body.ollamaModel) setSetting("ai_ollama_model", body.ollamaModel);
  }

  return NextResponse.json({ success: true });
}
