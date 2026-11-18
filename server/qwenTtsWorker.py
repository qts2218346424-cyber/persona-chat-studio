import sys
import os
import re
import json
import base64

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

OTOME_VOICE_DESCRIPTIONS = {
    "otome_boss": (
        "27岁AI漫剧与乙女游戏霸道深情男主角，极其低沉磁性的胸腔共鸣低音炮，"
        "嗓音微哑性感，语速沉缓克制，贴近耳畔低语，带有真实的轻叹气声与宠溺拉丝尾音，标准普通话商业CV声优质感。"
    ),
    "otome_cool": (
        "25岁乙女游戏高冷禁欲系男主角，清润冷冽却温柔磁性的青年男神音，"
        "吐字干净克制，贴近耳畔轻声安抚，带有自然的换气呼吸感与护短宠溺感，顶级国产乙游男主配音质感。"
    ),
    "otome_fox": (
        "24岁漫剧腹黑贵公子男主角，温润磁性中带着三分慵懒笑意与漫不经心的撩拨感，"
        "尾音微微上挑带钩子，贴近耳边似笑非笑低语，顶级广播剧男主CV声优质感。"
    ),
    "otome_sunny": (
        "20岁乙女游戏阳光清朗年下学弟男主角，干净澄澈富有少年感的温柔男声，"
        "呼吸鲜活自然，充满真诚偏爱与直球亲昵感，完全口语化生活感。"
    ),
    "otome_queen": (
        "25岁高冷清艳御姐女主角，嗓音清冽温润略带微哑磁性，吐字从容优雅，"
        "表面克制高贵却在尾音流露只对你一人的温柔宠溺与耳畔轻叹气声，顶级商业游戏御姐CV质感。"
    ),
    "cute_sweet": (
        "19岁元气甜美双马尾学妹女主角，嗓音清甜澄澈充满少女灵动感，"
        "带着盈盈笑意与直球亲昵感，呼吸自然鲜活，顶级二次元恋爱游戏甜妹CV声优质感。"
    ),
    "cute_mochi": (
        "软萌可爱的二次元治愈系少女配音，嗓音清甜软糯灵动，充满亲昵撒娇笑意与元气呼吸感，自然生活化无朗读腔。"
    ),
}


def clean_dialogue_text(raw: str) -> str:
    text = str(raw or "")
    text = re.sub(r"\*[^*]+\*", "，", text)
    text = re.sub(r"^>.*$", "", text, flags=re.MULTILINE)
    text = re.sub(
        r"[^\u4e00-\u9fa5a-zA-Z0-9，。！？、；：“”‘’（）,.!?;:…—\-\s%]",
        "",
        text,
    )
    text = re.sub(r"\s+", " ", text).strip()
    return text[:260]


def main():
    try:
        from gradio_client import Client, handle_file
    except Exception as exc:
        print(json.dumps({"ready": False, "error": str(exc)}), flush=True)
        return

    clients = {}

    def get_client(hf_token: str):
        key = hf_token.strip() or "__anon__"
        if key not in clients:
            kwargs = {"verbose": False}
            if key != "__anon__":
                kwargs["token"] = key
            clients[key] = Client("Qwen/Qwen3-TTS", **kwargs)
        return clients[key]

    try:
        get_client("")
        print(json.dumps({"ready": True, "engine": "Qwen3-TTS-1.7B-VoiceDesign"}), flush=True)
    except Exception as exc:
        print(json.dumps({"ready": False, "error": str(exc)}), flush=True)
        return

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = ""
        try:
            payload = json.loads(line)
            req_id = payload.get("id", "")
            mode = payload.get("mode", "design")
            raw_text = payload.get("text", "")
            voice_key = payload.get("voice", "otome_cool")
            hf_token = payload.get("hf_token", "")

            cleaned = clean_dialogue_text(raw_text)
            if not cleaned:
                print(json.dumps({"id": req_id, "ok": False, "error": "无可朗读对白文本"}), flush=True)
                continue

            client = get_client(hf_token)
            out_audio_path = None
            status = ""

            ref_wav_path = payload.get("ref_wav_path", "")
            ref_text = payload.get("ref_text", "")
            if mode == "clone" and ref_wav_path and os.path.isfile(ref_wav_path):
                res_audio, status = client.predict(
                    ref_audio=handle_file(ref_wav_path),
                    ref_text=ref_text or cleaned[:20],
                    target_text=cleaned,
                    language="Chinese",
                    use_xvector_only=not bool(ref_text),
                    model_size="1.7B",
                    api_name="/generate_voice_clone",
                )
                out_audio_path = res_audio
            else:
                desc = payload.get("custom_desc") or OTOME_VOICE_DESCRIPTIONS.get(
                    voice_key, OTOME_VOICE_DESCRIPTIONS["otome_cool"]
                )
                res_audio, status = client.predict(
                    text=cleaned,
                    language="Chinese",
                    voice_description=desc,
                    api_name="/generate_voice_design",
                )
                out_audio_path = res_audio

            if not out_audio_path or not os.path.isfile(out_audio_path):
                print(json.dumps({"id": req_id, "ok": False, "error": f"未返回有效音频文件: {status}"}), flush=True)
                continue

            with open(out_audio_path, "rb") as f:
                audio_bytes = f.read()

            try:
                os.remove(out_audio_path)
            except OSError:
                pass

            b64 = base64.b64encode(audio_bytes).decode("ascii")
            print(
                json.dumps(
                    {
                        "id": req_id,
                        "ok": True,
                        "audio_b64": b64,
                        "mime": "audio/wav",
                        "voice": voice_key,
                    }
                ),
                flush=True,
            )
        except Exception as exc:
            print(json.dumps({"id": req_id, "ok": False, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
