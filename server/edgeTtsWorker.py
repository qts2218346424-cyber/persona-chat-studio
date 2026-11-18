import sys
import json
import base64
import asyncio

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

# 9 档男女角色精细声优音源与韵律配置（24kHz 零底噪神经语音 API）
EDGE_VOICE_PROFILES = {
    # 男主矩阵
    "otome_boss": {"voice": "zh-CN-YunjianNeural", "rate": "-7%", "pitch": "-5Hz"},
    "otome_daddy": {"voice": "zh-CN-YunjianNeural", "rate": "-3%", "pitch": "-2Hz"},
    "otome_gentle": {"voice": "zh-TW-YunJheNeural", "rate": "-4%", "pitch": "-2Hz"},
    "otome_cool": {"voice": "zh-CN-YunxiNeural", "rate": "-6%", "pitch": "-5Hz"},
    "otome_fox": {"voice": "zh-CN-YunyangNeural", "rate": "-3%", "pitch": "-2Hz"},
    "otome_sunny": {"voice": "zh-CN-YunxiNeural", "rate": "+3%", "pitch": "+2Hz"},
    # 女主矩阵
    "otome_queen": {"voice": "zh-CN-XiaoxiaoNeural", "rate": "-5%", "pitch": "-3Hz"},
    "otome_sister": {"voice": "zh-TW-HsiaoChenNeural", "rate": "-4%", "pitch": "+0Hz"},
    "cute_sweet": {"voice": "zh-CN-XiaoyiNeural", "rate": "+3%", "pitch": "+2Hz"},
    "cute_mochi": {"voice": "zh-CN-XiaoyiNeural", "rate": "+5%", "pitch": "+4Hz"},
}


async def synth_one(edge_tts, text: str, voice_key: str) -> bytes:
    prof = EDGE_VOICE_PROFILES.get(voice_key, EDGE_VOICE_PROFILES["otome_cool"])
    kwargs = {"rate": prof["rate"]}
    if prof["pitch"] and prof["pitch"] != "+0Hz":
        kwargs["pitch"] = prof["pitch"]

    comm = edge_tts.Communicate(text, prof["voice"], **kwargs)
    chunks = []
    async for msg in comm.stream():
        if msg.get("type") == "audio" and msg.get("data"):
            chunks.append(msg["data"])
    return b"".join(chunks)


def main():
    try:
        import edge_tts
    except Exception as exc:
        print(json.dumps({"ready": False, "error": str(exc)}), flush=True)
        return

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    print(json.dumps({"ready": True, "engine": "AzureEdgeNeural-24kHz"}), flush=True)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        req_id = ""
        try:
            payload = json.loads(line)
            req_id = payload.get("id", "")
            text = str(payload.get("text", "")).strip()
            voice_key = str(payload.get("voice", "otome_cool")).strip()
            if not text:
                print(json.dumps({"id": req_id, "ok": False, "error": "空文本"}), flush=True)
                continue

            mp3_bytes = loop.run_until_complete(synth_one(edge_tts, text[:340], voice_key))
            if not mp3_bytes or len(mp3_bytes) < 256:
                print(json.dumps({"id": req_id, "ok": False, "error": "未收到有效音频流"}), flush=True)
                continue

            b64 = base64.b64encode(mp3_bytes).decode("ascii")
            print(
                json.dumps(
                    {
                        "id": req_id,
                        "ok": True,
                        "audio_b64": b64,
                        "mime": "audio/mpeg",
                        "voice": voice_key,
                    }
                ),
                flush=True,
            )
        except Exception as exc:
            print(json.dumps({"id": req_id, "ok": False, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
