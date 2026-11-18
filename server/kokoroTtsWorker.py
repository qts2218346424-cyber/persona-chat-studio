import sys
import os
import re
import json
import base64
import struct
import numpy as np

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_MODEL = os.path.expanduser(r"~\.cache\hyperframes\tts\models\kokoro-v1.0.onnx")
DEFAULT_VOICES = os.path.expanduser(r"~\.cache\hyperframes\tts\voices\voices-v1.0.bin")

MODEL_PATH = os.environ.get("KOKORO_MODEL_PATH", DEFAULT_MODEL)
VOICES_PATH = os.environ.get("KOKORO_VOICES_PATH", DEFAULT_VOICES)

DIGIT_MAP = {
    "0": "零", "1": "一", "2": "二", "3": "三", "4": "四",
    "5": "五", "6": "六", "7": "七", "8": "八", "9": "九"
}


def clean_text_for_zh_tts(raw: str) -> str:
    text = str(raw or "")
    text = re.sub(r"\*[^*]+\*", "，", text)
    text = re.sub(r"^>.*$", "", text, flags=re.MULTILINE)
    text = text.replace("100%", "百分之百").replace("%", "百分之")
    text = re.sub(
        r"Lv\.?\s*(\d+)",
        lambda m: "等级" + "".join(DIGIT_MAP.get(c, c) for c in m.group(1)),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\d+", lambda m: "".join(DIGIT_MAP.get(c, c) for c in m.group(0)), text)
    # 保留省略号以生成乙游/漫剧标志性的呼吸欲言又止停顿
    text = re.sub(r"\.{2,}|…+", "…", text)
    text = re.sub(r"[^\u4e00-\u9fa5a-zA-Z，。！？、；：,.!?;:…—\s]", " ", text)
    text = re.sub(r"[~～]+", "，", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:280]


def warm_studio_polish(samples: np.ndarray, sample_rate: int, is_deep_male: bool) -> np.ndarray:
    """
    轻量录音棚声学润色：柔化小模型高频电子金属毛刺，增强男主近讲胸腔温暖度
    """
    if len(samples) < 32:
        return samples
    x = samples.astype(np.float32)
    # 一阶柔和去毛刺平滑（抑制 >8.5kHz 合成器颗粒噪声，保留清晰咬字）
    alpha = 0.78 if is_deep_male else 0.86
    out = np.empty_like(x)
    out[0] = x[0]
    for i in range(1, len(x)):
        out[i] = alpha * x[i] + (1.0 - alpha) * out[i - 1]

    # 软饱和温暖谐波激励（模拟电子管话放微饱和，提升低音磁性密度）
    drive = 1.18 if is_deep_male else 1.08
    out = np.tanh(out * drive) / np.tanh(drive)

    # 首尾 12ms 渐入渐出消除拼接咔哒声
    fade_len = min(int(sample_rate * 0.012), len(out) // 4)
    if fade_len > 4:
        ramp = np.linspace(0.0, 1.0, fade_len, dtype=np.float32)
        out[:fade_len] *= ramp
        out[-fade_len:] *= ramp[::-1]
    return out


def encode_wav_pcm16(samples: np.ndarray, sample_rate: int) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype(np.int16)
    raw_bytes = pcm16.tobytes()
    data_size = len(raw_bytes)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        sample_rate,
        sample_rate * 2,
        2,
        16,
        b"data",
        data_size,
    )
    return header + raw_bytes


def build_otome_blended_presets(kokoro, available_voices: set) -> dict:
    """
    在 256 维声纹嵌入空间中线性混合调配「乙游四大男主 & AI 漫剧爆款」定制声纹
    """
    presets = {}

    def get_v(name, fallback="zm_yunxi"):
        target = name if name in available_voices else fallback
        return kokoro.get_voice_style(target)

    if {"zm_yunjian", "zm_yunxi", "zm_yunyang", "zm_yunxia"}.issubset(available_voices):
        # 1. 漫剧低音霸总音（重胸腔磁性 + 沉稳青叔压迫感）
        presets["otome_boss"] = 0.76 * get_v("zm_yunjian") + 0.24 * get_v("zm_yunyang")
        # 2. 乙游清冷禁欲音（清透公子底色 + 三分低沉克制苏感）
        presets["otome_cool"] = 0.66 * get_v("zm_yunxi") + 0.34 * get_v("zm_yunjian")
        # 3. 漫剧腹黑狐狸音（温润公子 + 慵懒微撩尾韵）
        presets["otome_fox"] = 0.54 * get_v("zm_yunxi") + 0.26 * get_v("zm_yunyang") + 0.20 * get_v("zm_yunjian")
        # 4. 乙游阳光奶狗音（清朗少年男音，兼具活力与温柔苏感）
        presets["otome_sunny"] = 0.70 * get_v("zm_yunxia") + 0.30 * get_v("zm_yunxi")

    if {"zf_xiaoyi", "zf_xiaoxiao"}.issubset(available_voices):
        # 5. 高冷清艳御姐音（知性沉静女声底色）
        presets["otome_queen"] = 0.78 * get_v("zf_xiaoxiao", "zf_xiaoyi") + 0.22 * get_v("zf_xiaoyi")
        # 6. 甜美元气学妹音（清甜灵动少女音）
        presets["cute_sweet"] = 0.85 * get_v("zf_xiaoyi") + 0.15 * get_v("zf_xiaoxiao", "zf_xiaoyi")
        # 7. 软萌糯米团子音
        presets["cute_mochi"] = 0.78 * get_v("zf_xiaoyi") + 0.22 * get_v("zf_xiaoxiao")

    return presets


def main():
    if not (os.path.isfile(MODEL_PATH) and os.path.isfile(VOICES_PATH)):
        print(json.dumps({"ready": False, "error": "Kokoro model files not found"}), flush=True)
        return

    try:
        import logging
        import jieba
        jieba.setLogLevel(logging.ERROR)

        from misaki import zh
        import kokoro_onnx

        g2p = zh.ZHG2P()
        kokoro = kokoro_onnx.Kokoro(MODEL_PATH, VOICES_PATH)
        valid_vocab = set(kokoro.tokenizer.vocab.keys())
        available_voices = set(kokoro.get_voices())
        otome_presets = build_otome_blended_presets(kokoro, available_voices)
    except Exception as exc:
        print(json.dumps({"ready": False, "error": str(exc)}), flush=True)
        return

    print(
        json.dumps(
            {
                "ready": True,
                "voices": sorted(list(available_voices) + list(otome_presets.keys())),
            }
        ),
        flush=True,
    )

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = ""
        try:
            payload = json.loads(line)
            req_id = payload.get("id", "")
            raw_text = payload.get("text", "")
            voice_key = payload.get("voice", "otome_cool")
            speed = float(payload.get("speed", 0.94))
            speed = max(0.7, min(1.35, speed))

            if voice_key in otome_presets:
                voice_arg = otome_presets[voice_key]
            elif voice_key in available_voices:
                voice_arg = voice_key
            else:
                voice_arg = otome_presets.get("otome_cool", "zm_yunxi")

            is_deep_male = voice_key in ("otome_boss", "otome_cool", "otome_fox", "zm_yunjian", "zm_yunxi")

            cleaned = clean_text_for_zh_tts(raw_text)
            if not cleaned:
                print(json.dumps({"id": req_id, "ok": False, "error": "无可朗读的对白文本"}), flush=True)
                continue

            # 按句号/问号/感叹号/省略号/破折号细分呼吸韵律块，消除一口气念课文的播报感
            segments = re.split(r"(?<=[。！？!?；;…—])", cleaned)
            audio_parts = []
            sr = 24000

            for seg in segments:
                seg_clean = seg.strip()
                if not seg_clean:
                    continue
                is_hesitation = seg_clean.endswith("…") or seg_clean.endswith("—")
                ph_res = g2p(seg_clean)
                ph_str = ph_res[0] if isinstance(ph_res, tuple) else str(ph_res)
                filtered_ph = "".join(ch for ch in ph_str if ch in valid_vocab).strip()
                if not filtered_ph:
                    continue

                part_audio, sr = kokoro.create(filtered_ph, voice=voice_arg, speed=speed, is_phonemes=True)
                if len(part_audio) > 0:
                    polished = warm_studio_polish(part_audio, sr, is_deep_male)
                    audio_parts.append(polished)
                    # 省略号留出 0.34s 漫剧欲言又止呼吸感，普通句末留出 0.22s 从容停顿
                    pause_sec = 0.34 if is_hesitation else (0.24 if is_deep_male else 0.16)
                    audio_parts.append(np.zeros(int(sr * pause_sec), dtype=np.float32))

            if not audio_parts:
                print(json.dumps({"id": req_id, "ok": False, "error": "音素转换结果为空"}), flush=True)
                continue

            merged = np.concatenate(audio_parts)
            wav_bytes = encode_wav_pcm16(merged, sr)
            b64 = base64.b64encode(wav_bytes).decode("ascii")
            print(
                json.dumps(
                    {
                        "id": req_id,
                        "ok": True,
                        "audio_b64": b64,
                        "duration": round(len(merged) / sr, 2),
                        "voice": voice_key,
                    }
                ),
                flush=True,
            )
        except Exception as exc:
            print(json.dumps({"id": req_id, "ok": False, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
