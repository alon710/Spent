import { NextResponse } from "next/server";
import { setSetting } from "@/server/db/queries/settings";
import { encrypt } from "@/server/lib/encryption";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    provider: "claude" | "gemini" | "ollama" | "none";
    claudeApiKey?: string;
    geminiApiKey?: string;
    ollamaUrl?: string;
    ollamaModel?: string;
  };

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

  if (body.provider === "ollama") {
    if (body.ollamaUrl) setSetting("ai_ollama_url", body.ollamaUrl);
    if (body.ollamaModel) setSetting("ai_ollama_model", body.ollamaModel);
  }

  return NextResponse.json({ success: true });
}
